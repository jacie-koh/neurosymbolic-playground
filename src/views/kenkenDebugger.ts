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
import { solveKenKen, solveKenKenWithSteps, type Cage, type Op, type Grid, type KenKenSolveStep } from "../neural/genericKenKen";
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
  let playSteps: KenKenSolveStep[] = [];
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

  // Replay/Step/output stay in one fixed block at the top of the page, above the
  // randomizer -- so they're never pushed around by (or push around) the puzzle
  // grid below, and pressing Replay/Stop never shifts the page.
  const controlsHost = el("div");
  const randomizerHost = el("div");
  const body = el("div", { style: { marginTop: "16px" } });
  root.append(controlsHost, randomizerHost, body);

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
    playSteps = [];
    playIdx = 0;
    activeFile = file;
    selectedCage = null;
    clear(body);
    body.append(el("p", { class: "muted" }, "Loading trace…"));
    loadKenKenTrace(file)
      .then((t) => {
        trace = t;
        const source = loopActive() ? t.interpreted : t.recognized;
        cages = source.map((c) => ({ cells: c.cells, op: c.op, target: c.target }));
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

    const stepRow = el(
      "div",
      { class: "btn-row", style: { marginTop: "8px" } },
      el("button", { class: "btn", disabled: playing || playIdx <= 0, onclick: () => stepTo(t, playIdx - 1) }, "◀ Step back"),
      el("button", { class: "btn", disabled: playing || (playSteps.length > 0 && playIdx >= playSteps.length), onclick: () => stepTo(t, playIdx + 1) }, "Step forward ▶"),
      liveGrid ? el("span", { class: "muted", style: { fontSize: "12px", alignSelf: "center" } }, `step ${playIdx}/${playSteps.length || "?"}`) : ""
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

    clear(controlsHost);
    controlsHost.append(playRow, stepRow, logBox);

    body.append(
      el("div", { style: { display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "flex-start" } }, sourceImage, grid),
      meta,
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

  /** Whether the current playSteps reveal the real Z3-verified answer (cell by cell,
   * not a live search -- Z3's own internal decision process isn't recorded) rather
   * than an independent client-side backtracking re-solve. */
  let revealMode = false;

  function prepareSteps(t: KenKenTrace): void {
    revealMode = canShowRealSolution(t);
    if (revealMode) {
      const solution = t.result.solution!;
      playSteps = [];
      for (let r = 0; r < t.size; r++) {
        for (let c = 0; c < t.size; c++) playSteps.push({ row: r, col: c, digit: solution[r][c] });
      }
    } else {
      // Edited cages (or the offline baseline itself was unsat): Z3 never verified this
      // exact state, so fall back to an independent client-side search instead.
      playSteps = solveKenKenWithSteps(t.size, cages).steps;
    }
    playIdx = 0;
  }

  function stepLine(step: KenKenSolveStep): string {
    if (step.deadEnd) return `dead end at (${step.row + 1},${step.col + 1}): ${step.reason} — backtracking`;
    return revealMode
      ? `(${step.row + 1},${step.col + 1}): real Z3-verified answer = ${step.digit}`
      : step.digit
        ? `(${step.row + 1},${step.col + 1}): try ${step.digit}`
        : `(${step.row + 1},${step.col + 1}): backtrack`;
  }

  function resetLive(t: KenKenTrace): void {
    liveGrid = Array.from({ length: t.size }, () => Array(t.size).fill(0));
    logLines = [];
  }

  /** O(1): applies exactly one more step during auto-play, so a fast-ticking (as low
   * as 15ms) backtracking trace with hundreds of steps stays responsive -- replaying
   * from scratch every tick was O(n) per tick (O(n^2) overall) and could bog the tab
   * down badly enough that the Stop button stopped registering clicks in time. */
  function applyStep(step: KenKenSolveStep): void {
    if (liveGrid) liveGrid[step.row][step.col] = step.digit;
    logLines.push(stepLine(step));
  }

  /** O(n): only used for manual step-back/jump, which is infrequent -- replaying
   * from scratch is the only correct way to "undo" a backtrack step, which doesn't
   * carry the value it's reverting. */
  function applyStepsUpTo(t: KenKenTrace, n: number): void {
    resetLive(t);
    for (let i = 0; i < n; i++) applyStep(playSteps[i]);
  }

  function stepTo(t: KenKenTrace, idx: number): void {
    stopPlaying();
    if (playSteps.length === 0) prepareSteps(t);
    playIdx = Math.max(0, Math.min(playSteps.length, idx));
    applyStepsUpTo(t, playIdx);
    drawBody();
  }

  function playFrom(t: KenKenTrace): void {
    stopPlaying();
    prepareSteps(t);
    playing = true;
    resetLive(t);
    const delay = revealMode
      ? Math.max(60, Math.min(300, 6000 / Math.max(1, playSteps.length)))
      : Math.max(15, Math.min(120, 4000 / Math.max(1, playSteps.length)));
    // Capped re-render rate + batched steps per frame -- see sudokuDebugger.ts's
    // playFrom for why: rebuilding the whole grid on every tick at a tiny `delay`
    // made the Stop button get torn down and recreated faster than clicks could
    // reliably land on it.
    const RENDER_INTERVAL = 50;
    const stepsPerTick = Math.max(1, Math.round(RENDER_INTERVAL / delay));
    const tick = () => {
      if (!playing) return;
      for (let i = 0; i < stepsPerTick && playIdx < playSteps.length; i++) {
        applyStep(playSteps[playIdx]);
        playIdx++;
      }
      if (playIdx >= playSteps.length) {
        playing = false;
        drawBody();
        return;
      }
      drawBody();
      playTimer = setTimeout(tick, RENDER_INTERVAL);
    };
    drawBody();
    playTimer = setTimeout(tick, RENDER_INTERVAL);
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

  selectTrace(activeFile);
}
