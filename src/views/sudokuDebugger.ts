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
import { findConflicts, solveGeneric, solveGenericWithSteps, solveWithCorrectionLoop, explainRevealSteps, explainOfflineCorrections, type Grid, type SolveStep, type SolveResult } from "../neural/genericSudoku";
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
  /** Built once per trace load, not per drawBody() -- rebuilding this <img> on every
   * step/tick forced a relayout as it re-decoded, which is what was making the page
   * visibly jump on Step forward/back (and during auto-play). */
  let sourceImage: HTMLElement | null = null;
  /** Cache of solveGeneric(working) -- a full backtracking solve, expensive on a
   * 16x16 board with many blanks. `working` only ever changes at a handful of call
   * sites below (never during a tick), so recomputing it on every drawBody() call --
   * including every auto-play tick, even though its result is thrown away once
   * liveGrid takes over -- was real wasted work per frame, exactly the kind of thing
   * that previously made the Stop button unresponsive. Invalidated explicitly
   * wherever `working` is set or mutated. */
  let cachedSolve: SolveResult | null = null;
  function getSolve(): SolveResult {
    if (!cachedSolve) cachedSolve = solveGeneric(working);
    return cachedSolve;
  }

  function stopPlaying(): void {
    playing = false;
    if (playTimer !== undefined) {
      clearTimeout(playTimer);
      playTimer = undefined;
    }
  }

  const randomizerHost = el("div");
  const resetHost = el("div");
  const topRow = el("div", { style: { display: "flex", gap: "12px", alignItems: "flex-start", flexWrap: "wrap" } }, randomizerHost, resetHost);
  const body = el("div", { style: { marginTop: "16px" } });

  // The Start/Stop button is appended directly to root -- never inside body,
  // which drawBody() clears and rebuilds on every single auto-play tick
  // (~every 50ms) -- and created exactly once. This isn't just about reusing
  // the same JS object: even reusing the same node, moving it out of a parent
  // that gets clear()'d and back in still detaches it from the document for a
  // moment, which is enough for the browser to drop its internal "this
  // element is pressed" tracking -- so a real mouse click (mousedown, hold,
  // mouseup, unlike an instant synthetic test click) can still silently fail
  // to fire if ANY re-render happens while the mouse is held down, even with a
  // stable node reference. This was confirmed by screen recording (the run
  // never stopping despite the cursor sitting directly on the button) and
  // reproduced with a realistic held-mouse click in automation -- the only
  // real fix is for this button to never leave the document at all during
  // play. (This also moves it above the randomizer row, matching
  // KenKen/Zebra/VDP's layout instead of Sudoku's own previous one.)
  const startStopBtn = el("button", { class: "btn primary" });
  const startStopLabel = el("span", { class: "muted", style: { fontSize: "12px", alignSelf: "center" } });
  const playControlsHost = el("div", { class: "btn-row", style: { marginTop: "12px" } }, startStopBtn, startStopLabel);
  root.append(playControlsHost, topRow, body);
  function updatePlayButton(t: SudokuTrace): void {
    if (playing) {
      startStopBtn.textContent = "⏸ Stop";
      startStopBtn.onclick = () => { stopPlaying(); drawBody(); };
      startStopLabel.textContent = `solving… step ${playIdx}/${playSteps.length}`;
      startStopLabel.style.display = "";
    } else {
      startStopBtn.textContent = "▶ Start";
      startStopBtn.onclick = () => playFrom(t);
      startStopLabel.style.display = "none";
    }
  }

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
        cachedSolve = null;
        sourceImage = el(
          "div",
          { style: { flex: "0 0 auto" } },
          el("div", { style: { fontSize: "11px", color: "var(--muted)", marginBottom: "4px" } }, "Source image"),
          el("img", {
            src: t.imageUrl,
            alt: `Real ${t.style} photo of ${t.title}`,
            style: { display: "block", maxWidth: "220px", width: "100%", height: "auto", borderRadius: "6px", border: "1px solid var(--line)" },
          })
        );
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
    const solve = getSolve();

    const cellPx = t.size > 9 ? 32 : 46;
    const gridWidthPx = t.size * cellPx + (t.size - 1) * 8; // matches .lab-grid's 8px gap
    const grid = el("div", {
      class: "lab-grid",
      style: { gridTemplateColumns: `repeat(${t.size}, ${cellPx}px)` },
    });

    // The cell the LIVE correction loop is acting on right now (this playthrough),
    // distinct from correctionFor()'s offline-precomputed correction badge -- so the
    // grid visibly shows a cell being tried/reverted/fixed as the log narrates it.
    const lastAppliedStep = playIdx > 0 ? playSteps[playIdx - 1] : null;
    const liveCorrectionKind = lastAppliedStep?.correction?.kind ?? null;

    for (let r = 0; r < t.size; r++) {
      for (let c = 0; c < t.size; c++) {
        const given = t.recognized[r][c] !== 0;
        const value = working[r][c];
        const isSelected = selected && selected[0] === r && selected[1] === c;
        const isCorrected = !!correctionFor(t, r, c);
        const isAmbiguous = !!ambiguousFor(t, r, c);
        const isOverridden = overridden.has(cellKey(r, c));
        const isConflict = conflictCells.has(cellKey(r, c));
        const isLiveCorrectionTarget = !!liveCorrectionKind && lastAppliedStep!.row === r && lastAppliedStep!.col === c;
        const solverFill = !given ? (liveGrid ? liveGrid[r][c] || null : solve.solution ? solve.solution[r][c] : null) : null;

        let background = "var(--panel)";
        let color = "inherit";
        if (isLiveCorrectionTarget && (liveCorrectionKind === "try" || liveCorrectionKind === "corrected" || liveCorrectionKind === "revert")) {
          if (liveCorrectionKind === "corrected") { background = "rgba(46, 204, 113, 0.16)"; color = "var(--badge-weak-text)"; }
          else if (liveCorrectionKind === "revert") { background = "rgba(255, 68, 68, 0.16)"; color = "var(--danger-text)"; }
          else { background = "rgba(255, 170, 0, 0.16)"; color = "var(--warn-text)"; }
        } else if (isConflict) {
          background = "rgba(255, 68, 68, 0.16)";
          color = "var(--danger-text)";
        } else if (isOverridden) {
          background = "rgba(8, 119, 189, 0.16)";
        } else if (isAmbiguous) {
          background = "rgba(142, 68, 173, 0.18)";
          color = "var(--output-text)";
        } else if (isCorrected) {
          background = "rgba(245, 147, 34, 0.16)";
        } else if (!given) {
          background = "var(--panel-2)";
          color = "var(--muted)";
        }

        const pred = cellPrediction(t, r, c);
        const confDotColor = pred ? (pred.confidence >= 0.9 ? "#22c55e" : pred.confidence >= 0.7 ? "#f59322" : "#ef4444") : null;

        grid.append(
          el(
            "button",
            {
              style: {
                position: "relative",
                width: `${cellPx}px`,
                height: `${cellPx}px`,
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
            value !== 0 ? String(value) : solverFill != null ? String(solverFill) : "",
            // Confidence dot (bottom-right): only meaningful on a given cell's own
            // CNN reading, and only while showing the static reading, not a live step.
            confDotColor && !liveGrid
              ? el("span", { style: { position: "absolute", bottom: "2px", right: "3px", width: "4px", height: "4px", borderRadius: "50%", background: confDotColor } })
              : "",
            // Corrected marker (top-left): flags a cell the offline correction loop
            // actually changed, distinct from the background tint alone.
            isCorrected && !isOverridden && !liveGrid
              ? el("span", { style: { position: "absolute", top: "1px", left: "2px", fontSize: "7px", color: "var(--acid-text)" } }, "✱")
              : ""
          )
        );
      }
    }

    updatePlayButton(t);

    const stepRow = el(
      "div",
      { class: "btn-row", style: { marginTop: "8px" } },
      el("button", { class: "btn", disabled: playing || playIdx <= 0, onclick: () => stepTo(t, playIdx - 1) }, "◀ Step back"),
      el("button", { class: "btn", disabled: playing || (playSteps.length > 0 && playIdx >= playSteps.length), onclick: () => stepTo(t, playIdx + 1) }, "Step forward ▶"),
      liveGrid ? el("span", { class: "muted", style: { fontSize: "12px", alignSelf: "center" } }, `step ${playIdx}/${playSteps.length || "?"}`) : ""
    );

    const logBox = renderLiveLog(logLines);

    const gridLabel = el(
      "div",
      { style: { fontSize: "10px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" } },
      liveGrid
        ? lastAppliedStep
          ? stepLine(lastAppliedStep)
          : "solving…"
        : loopActive()
        ? "CNN interpretation (after correction loop)"
        : "Raw CNN reading (no correction)"
    );

    const legend = el(
      "div",
      { style: { display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "2px" } },
      ...[
        { color: "#22c55e", label: "High conf." },
        { color: "#f59322", label: "Low conf." },
        { color: "#ef4444", label: "Conflict" },
        { color: "var(--acid-text)", label: "✱ Corrected" },
        { color: "#c084fc", label: "Ambiguous" },
      ].map((l) =>
        el(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "4px" } },
          el("span", { style: { width: "6px", height: "6px", borderRadius: "50%", background: l.color, display: "inline-block" } }),
          el("span", { class: "muted", style: { fontSize: "10px" } }, l.label)
        )
      )
    );

    const z3Card = el(
      "div",
      {
        style: {
          background: t.result.status === "sat" ? "rgba(200, 241, 53, 0.08)" : "rgba(245, 147, 34, 0.08)",
          border: `1px solid ${t.result.status === "sat" ? "rgba(200, 241, 53, 0.35)" : "rgba(245, 147, 34, 0.35)"}`,
          borderRadius: "8px",
          padding: "10px 12px",
        },
      },
      el(
        "div",
        {
          style: {
            fontSize: "10px",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: t.result.status === "sat" ? "var(--acid-text)" : "var(--neural-text)",
            marginBottom: "4px",
          },
        },
        `Z3: ${t.result.status}`
      ),
      el(
        "div",
        { class: "muted", style: { fontSize: "11px", lineHeight: "1.4" } },
        t.result.status === "sat"
          ? `Solution found${t.result.unique === false ? " · not unique" : t.result.unique === true ? " · unique" : ""}`
          : "No satisfying assignment found",
        t.correctionAttempts > 0 ? ` · ${t.corrections.length} correction(s) over ${t.correctionAttempts} attempt(s)` : ""
      )
    );

    const status = el(
      "div",
      { class: "note" },
      el("b", {}, "Current grid: "),
      solve.status === "sat"
        ? `satisfiable${conflicts.length === 0 ? "" : " (conflicts remain in the given clues)"}. ` +
          "Solver-filled cells are shown in gray on the grid above."
        : `unsatisfiable under the current readings${conflicts.length ? ` — ${conflicts.length} direct conflict${conflicts.length === 1 ? "" : "s"} among the given clues.` : "."}`
    );

    const meta = el(
      "div",
      { class: "flow-payload", style: { display: "block" } },
      loopActive()
        ? `${t.title} · Neural ↔ Symbolic (correction loop) · offline pipeline result: ${t.result.status}` +
          (t.result.unique != null ? `, unique=${t.result.unique}` : "") +
          (t.correctionAttempts ? ` · ${t.corrections.length} correction(s) applied over ${t.correctionAttempts} attempt(s)` : " · no corrections needed")
        : `${t.title} · one-shot reading (no correction loop)` +
          (t.corrections.length ? `; the real pipeline's correction loop fixed ${t.corrections.length} cell(s) from here` : "")
    );

    const ambiguityNote =
      t.ambiguousGivens.length > 0
        ? el(
            "div",
            { class: "note" },
            el("span", { class: "badge badge-strong" }, "sat but possibly wrong"),
            ` this puzzle solved ${t.result.status === "sat" ? "successfully" : ""}, but ${t.ambiguousGivens.length} ` +
              `given cell${t.ambiguousGivens.length === 1 ? "" : "s"} (purple below) has a low-confidence reading whose ranked ` +
              "alternative ALSO produces a valid, different solution — a Sudoku symmetric-swap ambiguity the bounded correction " +
              "search never sees, since it only runs when the given readings conflict outright. Click a purple cell for details."
          )
        : "";

    const panel = el("div", { class: "note" });
    drawPanel(panel, t);

    const correctionLoopBox =
      t.corrections.length > 0
        ? el(
            "div",
            { class: "note" },
            el(
              "div",
              { style: { fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", marginBottom: "8px" } },
              `Correction loop · ${t.correctionAttempts} attempt${t.correctionAttempts !== 1 ? "s" : ""}`
            ),
            ...t.corrections.map((corr, i) =>
              el(
                "div",
                { style: { display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--muted)", marginTop: i > 0 ? "5px" : "0" } },
                el("span", { style: { fontSize: "10px", color: "var(--muted)", minWidth: "14px" } }, String(i + 1)),
                `(${corr.row + 1},${corr.col + 1})`,
                el("span", { style: { color: "var(--neural-text)" } }, String(corr.before)),
                el("span", {}, "→"),
                el("span", { style: { color: "var(--acid-text)" } }, String(corr.after)),
                el("span", { style: { marginLeft: "auto", fontSize: "10px" } }, `${(corr.score * 100).toFixed(2)}%`)
              )
            )
          )
        : "";

    const resetBtn = el(
      "button",
      {
        class: "btn",
        style: { marginTop: "12px" },
        onclick: () => {
          stopPlaying();
          liveGrid = null;
          logLines = [];
          playSteps = [];
          playIdx = 0;
          const source = loopActive() ? t.interpreted : t.recognized;
          working = source.map((row) => [...row]);
          cachedSolve = null;
          overridden.clear();
          selected = null;
          drawBody();
        },
      },
      "Reset to pipeline readings"
    );

    clear(resetHost);
    // Only shown once something's actually been overridden -- otherwise it'd sit
    // there unconditionally with nothing to reset, unlike the Figma reference.
    if (overridden.size > 0) resetHost.append(resetBtn);

    // Grid + its own play/step controls and live log sit in a fixed-width left
    // column; the source image, Z3 result, mode meta, ambiguity note, cell-detail
    // panel, and correction log sit in a right column that grows to fill the rest
    // -- matching the Figma reference's per-puzzle layout (grid+controls left,
    // info panels right), distinct from KenKen/Zebra/VDP's single-column layouts
    // below. An explicit pixel width (not "auto") on this grid item is
    // load-bearing: CSS grid sizes an "auto" column to its item's max-content
    // width, which for wrappable text is measured as if laid out on one line -- a
    // long log line would otherwise balloon this whole column (and the grid it's
    // in) far past the puzzle grid's actual width. See liveLog.ts for the
    // matching fix on the log box itself.
    // Kept in sync with the grid's own width so the Start/Stop button (now
    // living outside this column -- see playControlsHost above) still lines
    // up visually with it, even though puzzle size (and therefore gridWidthPx)
    // can change between traces.
    playControlsHost.style.width = `${gridWidthPx}px`;
    playControlsHost.style.boxSizing = "border-box";
    const leftCol = el(
      "div",
      { style: { display: "flex", flexDirection: "column", gap: "6px", width: `${gridWidthPx}px`, boxSizing: "border-box" } },
      stepRow,
      gridLabel,
      grid,
      legend,
      logBox
    );
    // A fixed pixel width here (not "1fr"/"auto") is load-bearing for the same
    // reason as leftCol's above, but for a subtler reason: this page is
    // centered via the debugger host's width: fit-content (results.ts), which
    // sizes itself to its content's *max-content* width -- and that CSS
    // measurement assumes text is laid out with no line breaks at all, even
    // wrappable text. So with this column at "auto"/1fr, whichever bit of
    // status/panel/meta text happened to be longest on a given render would
    // nudge fit-content's answer, and the whole debugger would visibly change
    // width. An explicit width makes this column's contribution to that
    // calculation a fixed number, independent of its content.
    const rightCol = el(
      "div",
      { style: { display: "flex", flexDirection: "column", gap: "12px", width: "420px", boxSizing: "border-box" } },
      el(
        "div",
        { style: { display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "flex-start" } },
        sourceImage!,
        el("div", { style: { flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "6px" } }, z3Card, status)
      ),
      meta,
      ambiguityNote,
      panel,
      correctionLoopBox
    );

    body.append(el("div", { style: { display: "grid", gridTemplateColumns: `${gridWidthPx}px 420px`, gap: "20px", alignItems: "start" } }, leftCol, rightCol));
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
    // Neural <-> Symbolic only: replay the offline pipeline's OWN self-correction(s)
    // first, whenever they're still what's on screen (nothing overridden) -- a
    // historical fact about this trace, so it belongs at the front of the log/grid
    // regardless of which branch runs next. Without this, a fresh, unedited example
    // never demonstrated the pipeline reworking a bad reading at all: revealMode
    // jumps straight to the final answer, and the live loop below only re-engages
    // if the user breaks something themselves.
    const offlineReplay = loopActive() && overridden.size === 0 ? explainOfflineCorrections(t.recognized, t.corrections) : [];
    if (revealMode) {
      playSteps = [...offlineReplay, ...explainRevealSteps(working, t.result.solution!)];
    } else if (loopActive()) {
      // Neural <-> Symbolic: this is specifically the pattern with a real bounded
      // correction loop. If the given digits directly conflict, run a real
      // confidence-ranked correction loop (client-side port of puzzlelab/
      // visual.py's search) over every given cell's real CNN alternatives except
      // ones the user explicitly locked in by overriding -- exactly mirroring what
      // the real offline pipeline does, using the real per-cell topK data this
      // trace already carries. This is the only pattern that ever reworks a given
      // reading; the log explains exactly why each changed cell was changed.
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
      playSteps = [...offlineReplay, ...correction.steps, ...fillSteps];
    } else {
      // Neural -> Symbolic (one-shot): CNN reads once, Z3 solves once -- no
      // correction, no reworking a given reading, and no narrated "why" a dead end
      // happened -- that explanatory reasoning belongs to the correction-loop
      // pattern only. explain:false keeps the mechanical try/backtrack trace but
      // drops the per-dead-end reason text.
      playSteps = solveGenericWithSteps(working, false).steps;
    }
    playIdx = 0;
  }

  function stepLine(step: SolveStep): string {
    if (step.correction) {
      const pos = `(${step.row + 1},${step.col + 1})`;
      const pct = step.correction.confidence != null ? ` (${(step.correction.confidence * 100).toFixed(1)}% confidence)` : "";
      switch (step.correction.kind) {
        case "conflict-found":
          return `conflict: ${step.reason}`;
        case "try":
          return `correction loop: trying real alternative ${step.digit} at ${pos}${pct} — still conflicts, reverting`;
        case "revert":
          return `  reverting ${pos} to ${step.digit}`;
        case "corrected":
          return `correction loop: real alternative ${step.digit} at ${pos}${pct} resolves the conflict`;
        case "give-up":
          return `correction loop gave up: ${step.reason}`;
      }
    }
    if (step.deadEnd) {
      return step.reason
        ? `dead end at (${step.row + 1},${step.col + 1}): ${step.reason} — backtracking`
        : `dead end at (${step.row + 1},${step.col + 1}) — backtracking`;
    }
    if (revealMode) {
      const base = `(${step.row + 1},${step.col + 1}): real Z3-verified answer = ${step.digit}`;
      return step.reason ? `${base} — ${step.reason}` : base;
    }
    return step.digit
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
    // A trace with very few steps (e.g. a one-shot unsat read that dead-ends
    // almost immediately) would otherwise finish in a single ~50ms tick --
    // Stop flashing back to Start faster than it's perceptible, reading as if
    // the button did nothing. Spacing out however many ticks it actually takes
    // so the whole run takes at least MIN_VISIBLE_MS keeps a genuinely long
    // search's pacing untouched (it already needs many ticks) while making a
    // short one visibly play out instead of instantly completing.
    const MIN_VISIBLE_MS = 400;
    const totalTicks = Math.max(1, Math.ceil(playSteps.length / stepsPerTick));
    const tickInterval = totalTicks < MIN_VISIBLE_MS / RENDER_INTERVAL ? MIN_VISIBLE_MS / totalTicks : RENDER_INTERVAL;
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
      playTimer = setTimeout(tick, tickInterval);
    };
    drawBody();
    playTimer = setTimeout(tick, tickInterval);
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
      const why = explainOfflineCorrections(t.recognized, [correction])[0].reason;
      rows.push(
        el(
          "div",
          { style: { marginTop: "6px" } },
          el("span", { class: "badge badge-strong" }, "self-corrected offline"),
          ` ${why} So it tried the alternative ${correction.after} (${(correction.score * 100).toFixed(2)}% confidence), which resolved it.`
        )
      );
    }
    const ambiguous = ambiguousFor(t, r, c);
    if (ambiguous) {
      rows.push(
        el(
          "div",
          { style: { marginTop: "6px" } },
          el("span", { class: "badge", style: { background: "rgba(142, 68, 173, 0.18)", color: "var(--output-text)", border: "1px solid rgba(142, 68, 173, 0.4)" } }, "sat but possibly wrong"),
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
                cachedSolve = null;
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
