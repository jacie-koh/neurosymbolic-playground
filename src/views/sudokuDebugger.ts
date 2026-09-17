/**
 * Interactive Reasoning Debugger — Sudoku module.
 *
 * Reads real traces produced by the standalone/ research backend: a pretrained
 * CNN reading a photographed grid, run through the authors' Z3 encoding, with
 * a bounded correction loop over ranked CNN alternatives when constraints
 * conflict. See standalone/README.md for the pipeline and its honesty caveats
 * ("sat" means the *interpreted* constraints have a solution, not that the
 * image was read correctly).
 *
 * Select a cell to see what the CNN actually read, its confidence, and its
 * ranked alternatives. Overriding a cell edits the interpreted grid and
 * reruns an exact client-side backtracking solve (genericSudoku.ts) — a
 * separate, honest re-solve, not a replay of the offline Z3 result.
 */

import { el, clear } from "../dom";
import {
  SUDOKU_TRACE_MANIFEST,
  loadSudokuTrace,
  loadSudokuManifest,
  type SudokuTrace,
  type SudokuManifestEntry,
  type CellPrediction,
} from "../data/traces";
import { findConflicts, solveGeneric, solveGenericWithSteps, solveWithCorrectionLoop, type Grid, type SolveStep } from "../neural/genericSudoku";
import { renderLiveLog } from "./liveLog";
import { renderRandomizer } from "./randomizer";
import { store } from "../state";

function cellKey(r: number, c: number): string {
  return `${r},${c}`;
}

/** Whether the chosen stacking pattern (set on the builder page) is the real bounded correction loop. */
function loopActive(): boolean {
  return store.get().pattern === "learning-reasoning";
}

export function renderSudokuDebugger(root: HTMLElement): void {
  clear(root);

  let activeFile = SUDOKU_TRACE_MANIFEST[0].file;
  let trace: SudokuTrace | null = null;
  /** The grid the user is currently working from: starts as trace.interpreted. */
  let working: Grid = [];
  let selected: [number, number] | null = null;
  /** Cells the user has manually overridden away from the trace's interpreted reading. */
  const overridden = new Set<string>();
  let playing = false;
  let playTimer: ReturnType<typeof setTimeout> | undefined;
  let playSteps: SolveStep[] = [];
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

  loadSudokuManifest()
    .then((manifest) => {
      renderRandomizer<SudokuManifestEntry>(randomizerHost, manifest, {
        fields: [
          { key: "size", label: "Size", get: (e) => e.size, order: [4, 9, 16] },
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
    selected = null;
    overridden.clear();
    clear(body);
    body.append(el("p", { class: "muted" }, "Loading trace…"));
    loadSudokuTrace(file)
      .then((t) => {
        trace = t;
        const source = loopActive() ? t.interpreted : t.recognized;
        working = source.map((row) => [...row]);
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

  function cellPrediction(t: SudokuTrace, r: number, c: number): CellPrediction | undefined {
    return t.predictions[cellKey(r, c)];
  }

  function correctionFor(t: SudokuTrace, r: number, c: number) {
    // Corrections only apply to what's actually on screen when the correction loop is active —
    // in one-shot mode we're deliberately showing the pre-correction (recognized) reading.
    if (!loopActive()) return undefined;
    return t.corrections.find((cc) => cc.row === r && cc.col === c);
  }

  function ambiguousFor(t: SudokuTrace, r: number, c: number) {
    return t.ambiguousGivens.find((a) => a.row === r && a.col === c);
  }

  function drawBody(): void {
    if (!trace) return;
    const t = trace;
    clear(body);

    const conflicts = findConflicts(working);
    const conflictCells = new Set(conflicts.map((cf) => cellKey(cf.row, cf.col)));
    const solve = solveGeneric(working);

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
      style: { gridTemplateColumns: `repeat(${t.size}, ${t.size > 9 ? 32 : 46}px)` },
    });

    for (let r = 0; r < t.size; r++) {
      for (let c = 0; c < t.size; c++) {
        const given = t.recognized[r][c] !== 0;
        const value = working[r][c];
        const isSelected = selected && selected[0] === r && selected[1] === c;
        const isCorrected = !!correctionFor(t, r, c);
        const isAmbiguous = !!ambiguousFor(t, r, c);
        const isOverridden = overridden.has(cellKey(r, c));
        const isConflict = conflictCells.has(cellKey(r, c));
        const solverFill = !given ? (liveGrid ? liveGrid[r][c] || null : solve.solution ? solve.solution[r][c] : null) : null;

        let background = "var(--panel)";
        let color = "inherit";
        if (isConflict) {
          background = "#fdecec";
          color = "#b3261e";
        } else if (isOverridden) {
          background = "#eef5fb";
        } else if (isAmbiguous) {
          background = "#f3e8ff";
          color = "#6b21a8";
        } else if (isCorrected) {
          background = "#fdecdc";
        } else if (!given) {
          background = "#f4f6f7";
          color = "var(--muted)";
        }

        grid.append(
          el(
            "button",
            {
              style: {
                width: t.size > 9 ? "32px" : "46px",
                height: t.size > 9 ? "32px" : "46px",
                border: isSelected ? "2px solid var(--pos)" : "1px solid var(--line)",
                borderRadius: "8px",
                background,
                color,
                fontWeight: given ? "700" : "500",
                fontSize: t.size > 9 ? "12px" : "16px",
                cursor: given ? "pointer" : "default",
              },
              "aria-label": `row ${r + 1} column ${c + 1}`,
              onclick: given ? () => { stopPlaying(); selected = [r, c]; drawBody(); } : undefined,
            },
            value !== 0 ? String(value) : solverFill != null ? String(solverFill) : ""
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
        ? `satisfiable${conflicts.length === 0 ? "" : " (conflicts remain in the given clues)"}. ` +
          "Solver-filled cells are shown in gray on the grid above."
        : `unsatisfiable under the current readings${conflicts.length ? ` — ${conflicts.length} direct conflict${conflicts.length === 1 ? "" : "s"} among the given clues.` : "."}`
    );

    const meta = el(
      "div",
      { class: "flow-payload", style: { marginTop: "10px", display: "block" } },
      loopActive()
        ? `${t.title} · ${t.style} · Neural ↔ Symbolic (correction loop) · offline pipeline result: ${t.result.status}` +
          (t.result.unique != null ? `, unique=${t.result.unique}` : "") +
          (t.correctionAttempts ? ` · ${t.corrections.length} correction(s) applied over ${t.correctionAttempts} attempt(s)` : " · no corrections needed")
        : `${t.title} · ${t.style} · one-shot reading (no correction loop) — showing what the CNN read before any correction was tried` +
          (t.corrections.length ? `; the real pipeline's correction loop fixed ${t.corrections.length} cell(s) from here` : "")
    );

    const ambiguityNote =
      t.ambiguousGivens.length > 0
        ? el(
            "div",
            { class: "note", style: { marginTop: "16px" } },
            el("span", { class: "badge badge-strong" }, "sat but possibly wrong"),
            ` this puzzle solved ${t.result.status === "sat" ? "successfully" : ""}, but ${t.ambiguousGivens.length} ` +
              `given cell${t.ambiguousGivens.length === 1 ? "" : "s"} (purple below) has a low-confidence reading whose ranked ` +
              "alternative ALSO produces a valid, different solution — a Sudoku symmetric-swap ambiguity the bounded correction " +
              "search never sees, since it only runs when the given readings conflict outright. Click a purple cell for details."
          )
        : "";

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
          working = source.map((row) => [...row]);
          overridden.clear();
          selected = null;
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
      ambiguityNote,
      status,
      panel,
      resetBtn
    );
  }

  /** True only when nothing's been edited and the offline Z3 pass actually found an answer — the only case where there's a real, verified solution to show. */
  function canShowRealSolution(t: SudokuTrace): boolean {
    // t.result was computed from t.interpreted (the corrected reading) — it only
    // corresponds to what's on screen when the Neural ↔ Symbolic loop is active and
    // nothing's been manually overridden. Any other pattern is showing the raw,
    // uncorrected reading, which the offline pipeline never separately solved.
    return loopActive() && overridden.size === 0 && t.result.status === "sat" && !!t.result.solution;
  }

  /** Whether the current playSteps reveal the real Z3-verified answer (cell by cell,
   * not a live search -- Z3's own internal decision process isn't recorded) rather
   * than an independent client-side backtracking re-solve. */
  let revealMode = false;

  function prepareSteps(t: SudokuTrace): void {
    revealMode = canShowRealSolution(t);
    if (revealMode) {
      const solution = t.result.solution!;
      playSteps = [];
      for (let r = 0; r < t.size; r++) {
        for (let c = 0; c < t.size; c++) {
          if (working[r][c] === 0) playSteps.push({ row: r, col: c, digit: solution[r][c] });
        }
      }
    } else {
      // Edited puzzle (or the offline baseline itself was unsat): Z3 never verified this
      // exact state, so fall back to an independent client-side search instead. If the
      // given digits directly conflict, first run a real confidence-ranked correction
      // loop (client-side port of puzzlelab/visual.py's search) over every given cell's
      // real CNN alternatives except ones the user explicitly locked in by overriding --
      // exactly mirroring what the real offline pipeline does, using the real per-cell
      // topK data this trace already carries.
      const topKByCell: Record<string, [number, number][]> = {};
      for (const [key, pred] of Object.entries(t.predictions)) {
        if (!overridden.has(key)) topKByCell[key] = pred.topK;
      }
      const correction = solveWithCorrectionLoop(working, topKByCell);
      // Only skip the fill phase if the loop actually engaged and gave up -- a broken
      // given set has nothing to fill. If it never engaged, or it found a fix, fall
      // through to the normal fill search (which will itself report unsat honestly
      // if the corrected givens still don't admit a solution).
      const giveUp = correction.engaged && correction.status === "unsat";
      const fillSteps = giveUp ? [] : solveGenericWithSteps(correction.correctedGiven).steps;
      playSteps = [...correction.steps, ...fillSteps];
    }
    playIdx = 0;
  }

  function stepLine(step: SolveStep): string {
    if (step.correction) {
      const pos = `(${step.row + 1},${step.col + 1})`;
      const pct = step.correction.confidence != null ? ` (${(step.correction.confidence * 100).toFixed(1)}% confidence)` : "";
      switch (step.correction.kind) {
        case "conflict-found":
          return `⚠ conflict: ${step.reason}`;
        case "try":
          return `⚙ correction loop: trying real alternative ${step.digit} at ${pos}${pct} — still conflicts, reverting`;
        case "revert":
          return `  ↩ ${pos} back to ${step.digit}`;
        case "corrected":
          return `✓ correction loop: real alternative ${step.digit} at ${pos}${pct} resolves the conflict`;
        case "give-up":
          return `✗ correction loop gave up: ${step.reason}`;
      }
    }
    if (step.deadEnd) return `⚠ dead end at (${step.row + 1},${step.col + 1}): ${step.reason} — backtracking`;
    return revealMode
      ? `(${step.row + 1},${step.col + 1}): real Z3-verified answer = ${step.digit}`
      : step.digit
        ? `(${step.row + 1},${step.col + 1}): try ${step.digit}`
        : `(${step.row + 1},${step.col + 1}): backtrack`;
  }

  function resetLive(): void {
    liveGrid = working.map((row) => [...row]);
    logLines = [];
  }

  /** O(1): applies exactly one more step during auto-play, so a fast-ticking (as low
   * as 15ms) backtracking trace with hundreds of steps stays responsive -- replaying
   * from scratch every tick was O(n) per tick (O(n^2) overall) and could bog the tab
   * down badly enough that the Stop button stopped registering clicks in time. */
  function applyStep(step: SolveStep): void {
    if (liveGrid) liveGrid[step.row][step.col] = step.digit;
    logLines.push(stepLine(step));
  }

  /** O(n): only used for manual step-back/jump, which is infrequent -- replaying
   * from scratch is the only correct way to "undo" a backtrack step, which doesn't
   * carry the value it's reverting. */
  function applyStepsUpTo(n: number): void {
    resetLive();
    for (let i = 0; i < n; i++) applyStep(playSteps[i]);
  }

  function stepTo(t: SudokuTrace, idx: number): void {
    stopPlaying();
    if (playSteps.length === 0) prepareSteps(t);
    playIdx = Math.max(0, Math.min(playSteps.length, idx));
    applyStepsUpTo(playIdx);
    drawBody();
  }

  function playFrom(t: SudokuTrace): void {
    stopPlaying();
    prepareSteps(t);
    playing = true;
    resetLive();
    const delay = revealMode
      ? Math.max(60, Math.min(300, 6000 / Math.max(1, playSteps.length)))
      : Math.max(15, Math.min(120, 4000 / Math.max(1, playSteps.length)));
    // Rebuilding the whole grid + log on every tick is real DOM work (worse on a
    // 16x16 board), and a large step count wants a tiny `delay` for the animation to
    // finish in a reasonable time -- but re-rendering that often meant the Stop
    // button was being torn down and recreated faster than clicks could reliably
    // land, making it stop only some of the time. Capping the actual re-render rate
    // and batching multiple logical steps into each visual frame keeps total
    // playback time the same while the button stays clickable throughout.
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

  function drawPanel(panel: HTMLElement, t: SudokuTrace): void {
    if (!selected) {
      panel.append("Select a given (bold) cell to see the CNN's reading, its confidence, and ranked alternatives.");
      return;
    }
    const [r, c] = selected;
    const pred = cellPrediction(t, r, c);
    const correction = correctionFor(t, r, c);
    if (!pred) {
      panel.append(`Cell (${r + 1}, ${c + 1}) has no recorded prediction.`);
      return;
    }
    const current = working[r][c];
    const isUserOverride = overridden.has(cellKey(r, c));
    const rows: HTMLElement[] = [
      el(
        "div",
        {},
        el("b", {}, `Cell (${r + 1}, ${c + 1}): `),
        `CNN read ${pred.value} at ${(pred.confidence * 100).toFixed(1)}% confidence.` +
          (isUserOverride ? ` Currently showing your override: ${current}.` : "")
      ),
    ];
    if (correction) {
      rows.push(
        el(
          "div",
          { style: { marginTop: "6px" } },
          el("span", { class: "badge badge-strong" }, "self-corrected offline"),
          ` the pipeline's own reading (${correction.before}) conflicted with a Sudoku constraint, so it tried the ` +
            `alternative ${correction.after} (${(correction.score * 100).toFixed(2)}% confidence) and that resolved the conflict.`
        )
      );
    }
    const ambiguous = ambiguousFor(t, r, c);
    if (ambiguous) {
      rows.push(
        el(
          "div",
          { style: { marginTop: "6px" } },
          el("span", { class: "badge", style: { background: "#f3e8ff", color: "#6b21a8", border: "1px solid #d9b8f5" } }, "sat but possibly wrong"),
          ` the offline pipeline never flagged this cell — it only reacts to outright conflicts — but its reading (${ambiguous.given}, ` +
            `${(ambiguous.confidence * 100).toFixed(1)}%) is far from certain, and the alternative ${ambiguous.alternative} ` +
            `(${ambiguous.alternativeConfidence != null ? (ambiguous.alternativeConfidence * 100).toFixed(1) : "?"}%) also solves the ` +
            "puzzle completely, just with a different final grid. Try it below to see the other valid solution."
        )
      );
    }
    if (pred.topK.length > 1) {
      const alts = el("div", { class: "digit-picker", style: { marginTop: "10px" } });
      alts.append(el("span", { class: "digit-picker-label" }, "Try:"));
      for (const [digit, prob] of pred.topK) {
        alts.append(
          el(
            "button",
            {
              class: "btn" + (current === digit ? " primary" : ""),
              style: { padding: "6px 10px" },
              onclick: () => {
                stopPlaying();
                liveGrid = null;
                logLines = [];
                working[r][c] = digit;
                overridden.add(cellKey(r, c));
                drawBody();
              },
            },
            `${digit} (${(prob * 100).toFixed(1)}%)`
          )
        );
      }
      rows.push(alts);
    }
    panel.append(...rows);
  }

  selectTrace(activeFile);
}
