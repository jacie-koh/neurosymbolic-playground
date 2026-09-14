/**
 * Interactive Reasoning Debugger — KenKen module.
 *
 * Reads real traces from the standalone backend: computer-vision cage
 * detection + a pretrained CNN reading each cage's target/operator glyphs,
 * solved and corrected against row/column uniqueness + cage arithmetic via Z3.
 * See standalone/puzzlelab/visual.py (kenken()).
 *
 * Select a cage to see the CNN's raw character-class reads and their ranked
 * alternatives, then edit its target/operator directly and rerun an exact
 * client-side backtracking solve (genericKenKen.ts) — a separate, honest
 * re-solve, not a replay of the offline Z3 pass.
 */

import { el, clear } from "../dom";
import { KENKEN_TRACE_MANIFEST, loadKenKenTrace, loadKenKenManifest, type KenKenTrace, type KenKenManifestEntry, type KenKenCagePrediction } from "../data/traces";
import { solveKenKen, solveKenKenWithSteps, type Cage, type Op, type Grid } from "../neural/genericKenKen";
import { renderLiveLog } from "./liveLog";
import { renderRandomizer } from "./randomizer";
import { store } from "../state";

/** Whether the chosen stacking pattern (set on the builder page) is the real bounded correction loop. */
function loopActive(): boolean {
  return store.get().pattern === "learning-reasoning";
}

const OP_SYMBOL: Record<Op, string> = { add: "+", sub: "−", mul: "×", div: "÷", "": "" };
const CLASS_LABEL = (cls: number): string =>
  cls <= 9 ? String(cls) : ({ 10: "+", 11: "÷", 12: "×", 13: "−" }[cls] ?? "?");

function cageKey(cage: { cells: [number, number][] }): string {
  return cage.cells.map(([r, c]) => `${r}:${c}`).join("|");
}

export function renderKenKenDebugger(root: HTMLElement): void {
  clear(root);

  let activeFile = KENKEN_TRACE_MANIFEST[0].file;
  let trace: KenKenTrace | null = null;
  let cages: Cage[] = [];
  let selectedCage: number | null = null;
  let playing = false;
  let playTimer: ReturnType<typeof setTimeout> | undefined;
  let playSteps: { row: number; col: number; digit: number }[] = [];
  let playIdx = 0;
  let liveGrid: Grid | null = null;
  let logLines: string[] = [];

  function stopPlaying(): void {
    playing = false;
    if (playTimer !== undefined) {
      clearTimeout(playTimer);
      playTimer = undefined;
    }
  }

  const randomizerHost = el("div");
  const picker = el("div", { class: "seg" });
  const body = el("div", { style: { marginTop: "16px" } });
  root.append(
    el("div", { class: "note", style: { marginBottom: "10px" } }, el("b", {}, "Curated highlights: "), "hand-picked examples with a specific story (below). Or pick real examples by size/style/legibility from the full pool:"),
    randomizerHost,
    picker,
    body
  );

  loadKenKenManifest()
    .then((manifest) => {
      renderRandomizer<KenKenManifestEntry>(randomizerHost, manifest, {
        fields: [
          { key: "size", label: "Size", get: (e) => e.size, order: [3, 4, 5, 6, 7, 8, 9] },
          { key: "style", label: "Style", get: (e) => e.style, order: ["printed", "handwritten"] },
          { key: "legibility", label: "Legibility", get: (e) => e.legibility, order: ["high", "medium", "low"] },
        ],
        onPick: (entry) => {
          if (!entry) {
            clear(body);
            body.append(el("p", { class: "note" }, "No real examples match that combination — try loosening a filter."));
            return;
          }
          selectTrace(entry.file);
        },
      });
    })
    .catch(() => {
      randomizerHost.append(el("p", { class: "muted", style: { fontSize: "12px" } }, "Randomizer unavailable — couldn't load the example manifest."));
    });

  function selectTrace(file: string): void {
    stopPlaying();
    liveGrid = null;
    logLines = [];
    activeFile = file;
    selectedCage = null;
    clear(body);
    body.append(el("p", { class: "muted" }, "Loading trace…"));
    loadKenKenTrace(file)
      .then((t) => {
        trace = t;
        const source = loopActive() ? t.interpreted : t.recognized;
        cages = source.map((c) => ({ cells: c.cells, op: c.op, target: c.target }));
        drawPicker();
        drawBody();
      })
      .catch(() => {
        clear(body);
        body.append(
          el("p", { class: "note" }, "Couldn't load this trace — the dev server may still be starting up."),
          el("button", { class: "btn", onclick: () => selectTrace(file) }, "Retry")
        );
      });
  }

  function drawPicker(): void {
    clear(picker);
    for (const entry of KENKEN_TRACE_MANIFEST) {
      picker.append(
        el(
          "button",
          { class: "seg-btn" + (entry.file === activeFile ? " active" : ""), onclick: () => selectTrace(entry.file) },
          el("span", { class: "seg-flow" }, entry.id.replace(/^kenken-/, "")),
          el("span", { class: "seg-name" }, `${entry.style} · ${entry.id.includes("correction") || entry.id.includes("handwritten") ? "has a self-correction" : "clean read"}`)
        )
      );
    }
  }

  function cellCageIndex(size: number): number[][] {
    const map: number[][] = Array.from({ length: size }, () => Array(size).fill(-1));
    cages.forEach((cage, i) => cage.cells.forEach(([r, c]) => { map[r][c] = i; }));
    return map;
  }

  function cageOrigin(cage: Cage): [number, number] {
    return cage.cells.reduce((min, cur) => (cur[0] < min[0] || (cur[0] === min[0] && cur[1] < min[1]) ? cur : min));
  }

  function correctionFor(t: KenKenTrace, cageIdx: number) {
    // Corrections only apply to what's actually on screen when the correction loop is active —
    // in one-shot mode we're deliberately showing the pre-correction (recognized) reading.
    if (!loopActive()) return undefined;
    return t.corrections.find((c) => c.cage === cageIdx);
  }

  function drawBody(): void {
    if (!trace) return;
    const t = trace;
    clear(body);

    const solve = solveKenKen(t.size, cages);
    const cellCage = cellCageIndex(t.size);
    const cellPx = t.size > 6 ? 44 : 56;

    const sourceImage = el(
      "div",
      { style: { flex: "0 0 auto" } },
      el("div", { style: { fontSize: "11px", color: "var(--muted)", marginBottom: "4px" } }, `Real ${t.style} source image — what the CNN actually read:`),
      el("img", {
        src: t.imageUrl,
        alt: `Real ${t.style} photo of ${t.title}`,
        style: { display: "block", maxWidth: "220px", width: "100%", height: "auto", borderRadius: "6px", border: "1px solid var(--line)" },
      })
    );

    const grid = el("div", {
      class: "lab-grid",
      style: { gridTemplateColumns: `repeat(${t.size}, ${cellPx}px)`, gridTemplateRows: `repeat(${t.size}, ${cellPx}px)`, gap: "2px" },
    });

    for (let r = 0; r < t.size; r++) {
      for (let c = 0; c < t.size; c++) {
        const cageIdx = cellCage[r][c];
        const cage = cages[cageIdx];
        const isOrigin = cage && cageOrigin(cage)[0] === r && cageOrigin(cage)[1] === c;
        const isSelected = selectedCage === cageIdx;
        const isCorrected = !!correctionFor(t, cageIdx);
        const value = liveGrid ? liveGrid[r][c] : solve.solution ? solve.solution[r][c] : 0;

        const right = c + 1 < t.size ? cellCage[r][c + 1] : -2;
        const down = r + 1 < t.size ? cellCage[r + 1][c] : -2;
        const baseBorder = isSelected ? "2px solid var(--pos)" : "1px solid var(--line)";

        grid.append(
          el(
            "button",
            {
              style: {
                position: "relative",
                width: `${cellPx}px`,
                height: `${cellPx}px`,
                border: baseBorder,
                borderRight: right !== cageIdx ? "3px solid var(--line-strong)" : baseBorder,
                borderBottom: down !== cageIdx ? "3px solid var(--line-strong)" : baseBorder,
                borderRadius: "4px",
                background: isCorrected ? "#fdecdc" : "var(--panel)",
                fontWeight: "700",
                fontSize: "16px",
                cursor: "pointer",
              },
              "aria-label": `row ${r + 1} column ${c + 1}`,
              onclick: () => { stopPlaying(); selectedCage = cageIdx; drawBody(); },
            },
            isOrigin
              ? el(
                  "span",
                  { style: { position: "absolute", top: "2px", left: "4px", fontSize: "10px", fontWeight: "700", color: "var(--muted)" } },
                  `${cage.target}${OP_SYMBOL[cage.op]}`
                )
              : "",
            value ? String(value) : ""
          )
        );
      }
    }

    const playRow = el(
      "div",
      { class: "btn-row", style: { marginTop: "12px" } },
      playing
        ? el("button", { class: "btn primary", onclick: () => { stopPlaying(); drawBody(); } }, "⏸ Stop")
        : el(
            "button",
            { class: "btn primary", onclick: () => playFrom(t) },
            canShowRealSolution(t)
              ? liveGrid ? "▶ Replay the real verified answer" : "▶ Reveal the real verified answer"
              : liveGrid ? "▶ Replay independent re-solve" : "▶ Watch independent re-solve (not Z3-verified)"
          ),
      playing
        ? el("span", { class: "muted", style: { fontSize: "12px", alignSelf: "center" } }, `solving… step ${playIdx}/${playSteps.length}`)
        : ""
    );

    const logBox = renderLiveLog(logLines);

    const status = el(
      "div",
      { class: "note", style: { marginTop: "16px" } },
      el("b", {}, "Client-side re-solve: "),
      solve.status === "sat"
        ? "satisfiable — the grid above shows a completion consistent with every cage as currently edited."
        : "unsatisfiable — no completion satisfies every cage as currently edited."
    );

    const meta = el(
      "div",
      { class: "flow-payload", style: { marginTop: "10px", display: "block" } },
      loopActive()
        ? `${t.title} · ${t.style} · Neural ↔ Symbolic (correction loop) · offline pipeline result: ${t.result.status}` +
          (t.result.unique != null ? `, unique=${t.result.unique}` : "") +
          (t.correctionAttempts ? ` · ${t.corrections.length} correction(s) applied over ${t.correctionAttempts} attempt(s)` : " · no corrections needed")
        : `${t.title} · ${t.style} · one-shot reading (no correction loop) — showing what the CNN read before any correction was tried` +
          (t.corrections.length ? `; the real pipeline's correction loop fixed ${t.corrections.length} cage(s) from here` : "")
    );

    const panel = el("div", { class: "note", style: { marginTop: "16px" } });
    drawPanel(panel, t);

    const resetBtn = el(
      "button",
      {
        class: "btn",
        style: { marginTop: "12px" },
        onclick: () => {
          stopPlaying();
          liveGrid = null;
          logLines = [];
          const source = loopActive() ? t.interpreted : t.recognized;
          cages = source.map((c) => ({ cells: c.cells, op: c.op, target: c.target }));
          selectedCage = null;
          drawBody();
        },
      },
      "Reset to pipeline readings"
    );

    body.append(
      el("div", { style: { display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "flex-start" } }, sourceImage, grid),
      meta,
      playRow,
      logBox,
      status,
      panel,
      resetBtn
    );
  }

  /** True only when nothing's been edited and the offline Z3 pass actually found an answer — the only case where there's a real, verified solution to show. */
  function canShowRealSolution(t: KenKenTrace): boolean {
    // t.result was computed from t.interpreted (the corrected reading) — it only
    // corresponds to what's on screen when the Neural ↔ Symbolic loop is active and
    // nothing's been manually edited. Any other pattern is showing the raw,
    // uncorrected reading, which the offline pipeline never separately solved.
    if (!loopActive()) return false;
    const source = t.interpreted.map((c) => ({ cells: c.cells, op: c.op, target: c.target }));
    const edited = JSON.stringify(cages) !== JSON.stringify(source);
    return !edited && t.result.status === "sat" && !!t.result.solution;
  }

  function playFrom(t: KenKenTrace): void {
    stopPlaying();
    logLines = [];
    playIdx = 0;
    playing = true;

    if (canShowRealSolution(t)) {
      // Reveal the real Z3-verified answer from the offline pipeline, cell by cell —
      // not a live search, since Z3's own internal decision process isn't recorded.
      const solution = t.result.solution!;
      playSteps = [];
      for (let r = 0; r < t.size; r++) {
        for (let c = 0; c < t.size; c++) playSteps.push({ row: r, col: c, digit: solution[r][c] });
      }
      liveGrid = Array.from({ length: t.size }, () => Array(t.size).fill(0));
      const delay = Math.max(60, Math.min(300, 6000 / Math.max(1, playSteps.length)));
      const tick = () => {
        if (!playing) return;
        if (playIdx >= playSteps.length) {
          playing = false;
          drawBody();
          return;
        }
        const step = playSteps[playIdx];
        if (liveGrid) liveGrid[step.row][step.col] = step.digit;
        logLines.push(`(${step.row + 1},${step.col + 1}): real Z3-verified answer = ${step.digit}`);
        playIdx++;
        drawBody();
        playTimer = setTimeout(tick, delay);
      };
      drawBody();
      playTimer = setTimeout(tick, delay);
      return;
    }

    // Edited cages (or the offline baseline itself was unsat): Z3 never verified this
    // exact state, so fall back to an independent client-side search instead.
    const result = solveKenKenWithSteps(t.size, cages);
    playSteps = result.steps;
    liveGrid = Array.from({ length: t.size }, () => Array(t.size).fill(0));
    const delay = Math.max(15, Math.min(120, 4000 / Math.max(1, playSteps.length)));
    const tick = () => {
      if (!playing) return;
      if (playIdx >= playSteps.length) {
        playing = false;
        drawBody();
        return;
      }
      const step = playSteps[playIdx];
      if (liveGrid) liveGrid[step.row][step.col] = step.digit;
      logLines.push(step.digit ? `(${step.row + 1},${step.col + 1}): try ${step.digit}` : `(${step.row + 1},${step.col + 1}): backtrack`);
      playIdx++;
      drawBody();
      playTimer = setTimeout(tick, delay);
    };
    drawBody();
    playTimer = setTimeout(tick, delay);
  }

  function findPrediction(t: KenKenTrace, cage: Cage): KenKenCagePrediction | undefined {
    const key = cageKey(cage);
    return t.predictions.find((p) => cageKey({ cells: p.cage }) === key);
  }

  function drawPanel(panel: HTMLElement, t: KenKenTrace): void {
    if (selectedCage == null) {
      panel.append("Select a cage (click any of its cells) to see the CNN's reading and edit it.");
      return;
    }
    const cage = cages[selectedCage];
    const pred = findPrediction(t, cage);
    const correction = correctionFor(t, selectedCage);

    const rows: HTMLElement[] = [
      el("div", {}, el("b", {}, `Cage ${selectedCage + 1} `), `(${cage.cells.length} cell${cage.cells.length === 1 ? "" : "s"})`),
    ];

    if (pred) {
      rows.push(
        el(
          "div",
          { class: "flow-payload", style: { marginTop: "8px", display: "block" } },
          `CNN read: ${pred.reads.map((r) => CLASS_LABEL(r)).join(" ")}`
        )
      );
    }

    if (correction) {
      rows.push(
        el(
          "div",
          { style: { marginTop: "8px" } },
          el("span", { class: "badge badge-strong" }, "self-corrected offline"),
          ` the pipeline's own reading (${OP_SYMBOL[correction.before.op] || "="} ${correction.before.target}) conflicted with a ` +
            `constraint, so it tried ${OP_SYMBOL[correction.after.op] || "="} ${correction.after.target} instead, which resolved the puzzle.`
        )
      );
    }

    const opSelect = el(
      "select",
      {
        disabled: cage.cells.length === 1,
        onchange: (e: Event) => { stopPlaying(); liveGrid = null; logLines = []; cage.op = (e.target as HTMLSelectElement).value as Op; drawBody(); },
      },
      ...(["add", "sub", "mul", "div"] as Op[]).map((op) => el("option", { value: op, selected: op === cage.op }, `${op} (${OP_SYMBOL[op]})`))
    );
    const targetInput = el("input", {
      type: "number",
      min: "1",
      value: String(cage.target),
      style: { width: "70px" },
      onchange: (e: Event) => { stopPlaying(); liveGrid = null; logLines = []; cage.target = Number((e.target as HTMLInputElement).value); drawBody(); },
    });

    rows.push(
      el(
        "div",
        { class: "digit-picker", style: { marginTop: "10px" } },
        el("span", { class: "digit-picker-label" }, "Try:"),
        cage.cells.length > 1 ? opSelect : el("span", { class: "muted" }, "single cell"),
        targetInput
      )
    );

    panel.append(...rows);
  }

  drawPicker();
  selectTrace(activeFile);
}
