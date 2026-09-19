/**
 * Interactive Reasoning Debugger — Hitori module.
 *
 * Unlike the other modules, Hitori has no neural perception step: the grid
 * is given directly, and the interesting neurosymbolic work is turning a
 * solver-verified forced move into a human explanation. See
 * standalone/puzzlelab/hitori.py — for each cell not fixed by the user, it
 * tests the OPPOSITE of the cell's solved value; if that makes the puzzle
 * (locally, or with full connectivity) unsatisfiable, the cell's value is
 * proven forced, and the unsat core becomes plain-English evidence.
 *
 * Shade cells yourself and watch the rule check update live, or step through
 * the offline pipeline's real deductions (ranked local-first, per the paper)
 * to see the verified evidence — and, for the first one, a local-model
 * explanation the pipeline itself labels as prose, not a formal proof.
 */

import { el, clear } from "../dom";
import { HITORI_TRACE_MANIFEST, loadHitoriTrace, loadHitoriManifest, type HitoriTrace, type HitoriManifestEntry, type HitoriDeduction } from "../data/traces";
import { checkViolations, solveHitori, type ShadeGrid } from "../neural/genericHitori";
import { renderLiveLog } from "./liveLog";
import { renderRandomizer } from "./randomizer";
import { store } from "../state";

/** Whether the chosen stacking pattern (set on the builder page) is Symbolic → Neural — the only
 * pattern where Hitori's real pipeline actually runs its local-LLM explanation step. */
function explanationActive(): boolean {
  return store.get().pattern === "reasoning-for-learning";
}

function cellKey(r: number, c: number): string {
  return `${r},${c}`;
}

/** Pull "(row,col)" 1-based references out of an evidence sentence, for highlighting. */
function evidenceCells(evidence: string[]): Set<string> {
  const cells = new Set<string>();
  for (const line of evidence) {
    for (const m of line.matchAll(/\((\d+),\s*(\d+)\)/g)) {
      cells.add(cellKey(Number(m[1]) - 1, Number(m[2]) - 1));
    }
  }
  return cells;
}

export function renderHitoriDebugger(root: HTMLElement): void {
  clear(root);

  let activeFile = HITORI_TRACE_MANIFEST[0].file;
  let trace: HitoriTrace | null = null;
  let shaded: ShadeGrid = [];
  /** Cells the user has explicitly clicked — held fixed by "Solve from here". */
  let locked = new Set<string>();
  let deductionIdx = -1; // -1 = free exploration, no deduction selected
  let evidenceExpanded = false;
  /** Whether the current deduction's raw Z3 unsat-core (the actual assertion names,
   * not their plain-English gloss) is shown. */
  let proofExpanded = false;
  let solveMessage = "";
  let playing = false;
  let playTimer: ReturnType<typeof setTimeout> | undefined;
  const PLAY_DELAY_MS = 700;

  function stopPlaying(): void {
    playing = false;
    if (playTimer !== undefined) {
      clearTimeout(playTimer);
      playTimer = undefined;
    }
  }

  const randomizerHost = el("div");
  const body = el("div", { style: { marginTop: "16px" } });

  // The Start/Stop button is appended directly to root -- never inside body,
  // which drawBody() clears and rebuilds on every auto-play tick
  // (PLAY_DELAY_MS) -- and created exactly once. This isn't just about
  // reusing the same JS object: even reusing the same node, moving it out of
  // a parent that gets clear()'d and back in still detaches it from the
  // document for a moment, which is enough for the browser to drop its
  // internal "this element is pressed" tracking -- so a real mouse click
  // (mousedown, hold, mouseup, unlike an instant synthetic test click) can
  // still silently fail to fire if a re-render happens while the mouse is
  // held down, even with a stable node reference. Confirmed necessary in
  // sudokuDebugger.ts by screen recording and a realistic held-mouse click in
  // automation (Hitori's much slower 700ms tick rate makes the window far
  // narrower than Sudoku's, but the same class of bug applies). This also
  // moves it above the randomizer row, matching the other four debuggers'
  // layout instead of sitting inside the deduction panel.
  const startStopBtn = el("button", { class: "btn primary" });
  const startStopLabel = el("span", { class: "muted", style: { fontSize: "12px", alignSelf: "center" } });
  const playControlsHost = el("div", { class: "btn-row", style: { marginTop: "12px" } }, startStopBtn, startStopLabel);
  root.append(playControlsHost, randomizerHost, body);
  function updatePlayButton(t: HitoriTrace): void {
    if (playing) {
      startStopBtn.textContent = "⏸ Stop";
      startStopBtn.onclick = () => { stopPlaying(); drawBody(); };
      startStopLabel.textContent = `solving… ${Math.max(deductionIdx + 1, 0)}/${t.deductions.length}`;
      startStopLabel.style.display = "";
    } else {
      startStopBtn.textContent = "▶ Start";
      startStopBtn.onclick = () => playFrom(t);
      startStopLabel.style.display = "none";
    }
  }

  loadHitoriManifest()
    .then((manifest) => {
      renderRandomizer<HitoriManifestEntry>(randomizerHost, manifest, {
        fields: [
          { key: "rows", label: "Rows", get: (e) => e.rows },
          { key: "cols", label: "Columns", get: (e) => e.cols },
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
    activeFile = file;
    deductionIdx = -1;
    clear(body);
    body.append(el("p", { class: "muted" }, "Loading trace…"));
    loadHitoriTrace(file)
      .then((t) => {
        trace = t;
        shaded = t.grid.map((row) => row.map(() => false));
        locked = new Set();
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


  function drawBody(): void {
    if (!trace) return;
    const t = trace;
    clear(body);

    const violations = checkViolations(t.grid, shaded);
    const dupCells = new Set(violations.duplicates.map((v) => cellKey(v.row, v.col)));
    const adjCells = new Set(violations.adjacentShaded.map((v) => cellKey(v.row, v.col)));
    const highlighted = deductionIdx >= 0 ? evidenceCells(t.deductions[deductionIdx].evidence) : new Set<string>();
    const deducedCell = deductionIdx >= 0 ? cellKey(t.deductions[deductionIdx].row, t.deductions[deductionIdx].col) : null;

    const cols = t.grid[0].length;
    const cellPx = 52;
    const gridWidthPx = cols * cellPx + (cols - 1) * 8; // matches .lab-grid's 8px gap

    const gridLabel = el(
      "div",
      { style: { fontSize: "10px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" } },
      `${t.title} · click cells to shade/unshade`
    );

    const grid = el("div", { class: "lab-grid", style: { gridTemplateColumns: `repeat(${cols}, ${cellPx}px)` } });
    t.grid.forEach((row, r) =>
      row.forEach((value, c) => {
        const key = cellKey(r, c);
        const isShaded = shaded[r][c];
        let background = "var(--panel)";
        let color = "inherit";
        if (key === deducedCell) { background = "var(--symbolic)"; color = "#fff"; }
        else if (highlighted.has(key)) { background = "rgba(8, 119, 189, 0.16)"; }
        else if (isShaded) { background = "#000000"; color = "#fff"; }
        else if (dupCells.has(key) || adjCells.has(key)) { background = "rgba(255, 68, 68, 0.16)"; color = "var(--danger-text)"; }

        grid.append(
          el(
            "button",
            {
              style: {
                width: "52px", height: "52px",
                border: locked.has(key) ? "2px solid var(--pos)" : "1px solid var(--line)",
                borderRadius: "8px", background, color, fontWeight: "700", cursor: "pointer",
              },
              "aria-label": `row ${r + 1} column ${c + 1}: ${value}`,
              onclick: () => { stopPlaying(); shaded[r][c] = !shaded[r][c]; locked.add(key); deductionIdx = -1; solveMessage = ""; drawBody(); },
            },
            String(value)
          )
        );
      })
    );

    const legend = el(
      "div",
      { style: { display: "flex", gap: "10px", flexWrap: "wrap" } },
      ...[
        { swatch: "#000000", label: "Shaded" },
        { swatch: "var(--symbolic)", label: "Forced cell (current deduction)" },
        { swatch: "rgba(8, 119, 189, 0.16)", label: "Evidence cells" },
        { swatch: "rgba(255, 68, 68, 0.16)", label: "Violation" },
      ].map((l) =>
        el(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "4px" } },
          el("span", { style: { width: "10px", height: "10px", borderRadius: "2px", background: l.swatch, display: "inline-block", border: "1px solid var(--line-strong)" } }),
          el("span", { class: "muted", style: { fontSize: "10px" } }, l.label)
        )
      )
    );

    const issues = [
      violations.duplicates.length ? `${violations.duplicates.length / 2 | 0} duplicate pair(s) among unshaded cells` : "",
      violations.adjacentShaded.length ? `${violations.adjacentShaded.length / 2 | 0} adjacent shaded pair(s)` : "",
      violations.disconnected ? "unshaded cells are not all connected" : "",
    ].filter(Boolean);
    const solvedMatch = t.solution && JSON.stringify(shaded) === JSON.stringify(t.solution);
    const status = el(
      "div",
      { class: "note" },
      el("b", {}, "Rule check: "),
      issues.length ? issues.join("; ") + "." : solvedMatch ? "matches the verified unique solution." : "no violations yet — keep going.",
      solveMessage ? el("div", { style: { marginTop: "6px" } }, solveMessage) : ""
    );

    const z3Card = el(
      "div",
      {
        style: {
          background: t.status === "sat" ? "rgba(200, 241, 53, 0.08)" : "rgba(245, 147, 34, 0.08)",
          border: `1px solid ${t.status === "sat" ? "rgba(200, 241, 53, 0.35)" : "rgba(245, 147, 34, 0.35)"}`,
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
            color: t.status === "sat" ? "var(--acid-text)" : "var(--neural-text)",
            marginBottom: "4px",
          },
        },
        `Z3: ${t.status}`
      ),
      el(
        "div",
        { class: "muted", style: { fontSize: "11px", lineHeight: "1.4" } },
        t.status === "sat"
          ? `Solution found${t.unique === false ? " · not unique" : t.unique === true ? " · unique" : ""}`
          : "No valid shading found",
        t.deductions.length > 0 ? ` · ${t.deductions.length} forced cell${t.deductions.length !== 1 ? "s" : ""} proven` : ""
      )
    );

    const logLines =
      deductionIdx >= 0
        ? t.deductions
            .slice(0, deductionIdx + 1)
            .map((d, i) => `${i + 1}. (${d.row + 1},${d.col + 1}) forced ${d.shaded ? "shaded" : "unshaded"} — ${d.kind}`)
        : [];
    const logBox = renderLiveLog(logLines);

    const deductionPanel = el("div", { class: "note" });
    drawDeductionPanel(deductionPanel, t);

    const controls = el(
      "div",
      { class: "btn-row", style: { marginTop: "12px" } },
      el(
        "button",
        {
          class: "btn",
          onclick: () => { stopPlaying(); shaded = t.grid.map((row) => row.map(() => false)); locked = new Set(); deductionIdx = -1; solveMessage = ""; drawBody(); },
        },
        "Reset shading"
      ),
      el(
        "button",
        {
          class: "btn primary",
          onclick: () => {
            stopPlaying();
            const fixed = new Map<string, boolean>();
            locked.forEach((key) => {
              const [r, c] = key.split(",").map(Number);
              fixed.set(key, shaded[r][c]);
            });
            const res = solveHitori(t.grid, fixed);
            if (res.status === "sat" && res.solution) {
              shaded = res.solution;
              solveMessage = `Solved from your ${locked.size} locked cell(s) with a client-side backtracking search.`;
            } else {
              solveMessage = `Unsatisfiable: no completion respects your ${locked.size} locked cell(s) together. Reset and try a different shading.`;
            }
            drawBody();
          },
        },
        "Solve from here"
      ),
      el(
        "button",
        {
          class: "btn",
          onclick: () => { stopPlaying(); if (t.solution) shaded = t.solution.map((row) => [...row]); locked = new Set(); deductionIdx = -1; solveMessage = ""; drawBody(); },
        },
        "Reveal verified solution"
      )
    );

    // Grid + rule-check status + action buttons sit in a fixed-width left column;
    // the deduction step-through panel and live log sit in a right column that
    // grows to fill the rest -- matching the Figma reference's Hitori-specific
    // layout (grid+actions left, deduction panel right), distinct from the other
    // four debuggers' single-column layouts. The explicit pixel width on leftCol
    // (not "auto") is load-bearing -- see the matching note in sudokuDebugger.ts.
    const leftCol = el(
      "div",
      { style: { display: "flex", flexDirection: "column", gap: "8px", width: `${gridWidthPx}px`, boxSizing: "border-box" } },
      gridLabel,
      grid,
      legend,
      status,
      controls
    );
    // A fixed pixel width here (not "1fr" / "auto") is load-bearing, same as
    // leftCol above: this page is centered on the page via the debugger host's
    // width: fit-content (see results.ts), which sizes itself to its content's
    // *max-content* width -- and per the CSS spec, that measurement assumes
    // text is laid out with NO line breaks at all, even wrappable text with
    // overflow-wrap set. So as long as this column's own width was "auto"/1fr,
    // whichever deduction's evidence happened to have the longest unwrapped
    // line would nudge fit-content's answer, and the whole debugger (including
    // the log box, which is width: 100% of this column) would visibly change
    // width on every step. An explicit width makes this column's contribution
    // to that calculation a fixed number, independent of its content.
    const rightCol = el(
      "div",
      { style: { display: "flex", flexDirection: "column", gap: "12px", width: "420px", boxSizing: "border-box" } },
      deductionPanel,
      logBox,
      z3Card
    );

    body.append(el("div", { style: { display: "grid", gridTemplateColumns: `${gridWidthPx}px 420px`, gap: "20px", alignItems: "start" } }, leftCol, rightCol));
  }

  /** O(1): stepForward only ever advances by exactly one deduction, so there's no
   * need for applyDeduction's full from-scratch replay here -- just set the one
   * newly-forced cell. Auto-play's tick calls this every 700ms; replaying the whole
   * history so far on every tick was needless work on the hot loop, the same class
   * of bug already fixed for the other four debuggers' auto-play. */
  function stepForward(t: HitoriTrace): boolean {
    if (deductionIdx < 0) {
      shaded = t.grid.map((row) => row.map(() => false));
      locked = new Set();
    }
    if (deductionIdx >= t.deductions.length - 1) return false;
    deductionIdx = deductionIdx < 0 ? 0 : deductionIdx + 1;
    evidenceExpanded = false;
    proofExpanded = false;
    const d = t.deductions[deductionIdx];
    shaded[d.row][d.col] = d.shaded;
    return true;
  }

  function playFrom(t: HitoriTrace): void {
    stopPlaying();
    playing = true;
    deductionIdx = -1;
    shaded = t.grid.map((row) => row.map(() => false));
    locked = new Set();
    solveMessage = "";
    const tick = () => {
      if (!playing) return;
      stepForward(t);
      drawBody();
      if (playing && deductionIdx < t.deductions.length - 1) {
        playTimer = setTimeout(tick, PLAY_DELAY_MS);
      } else {
        playing = false;
        drawBody();
      }
    };
    drawBody();
    playTimer = setTimeout(tick, PLAY_DELAY_MS);
  }

  function drawDeductionPanel(panel: HTMLElement, t: HitoriTrace): void {
    updatePlayButton(t);
    const nav = el(
      "div",
      { class: "btn-row", style: { marginTop: "8px" } },
      el(
        "button",
        {
          class: "btn",
          disabled: playing || deductionIdx <= 0,
          onclick: () => { deductionIdx = Math.max(0, deductionIdx - 1); evidenceExpanded = false; proofExpanded = false; applyDeduction(t); drawBody(); },
        },
        "← Previous deduction"
      ),
      el(
        "button",
        {
          class: "btn",
          disabled: playing,
          onclick: () => {
            if (deductionIdx < 0) { shaded = t.grid.map((row) => row.map(() => false)); locked = new Set(); }
            deductionIdx = deductionIdx < 0 ? 0 : Math.min(t.deductions.length - 1, deductionIdx + 1);
            evidenceExpanded = false;
            proofExpanded = false;
            applyDeduction(t);
            drawBody();
          },
        },
        deductionIdx < 0 ? "Step through one deduction →" : "Next deduction →"
      )
    );
    panel.append(
      el("div", {}, el("b", {}, "Step-through: "), `${t.deductions.length} cells are forced, ranked local-first.`),
      nav
    );

    if (deductionIdx >= 0) {
      const d: HitoriDeduction = t.deductions[deductionIdx];
      panel.append(
        el(
          "div",
          { style: { marginTop: "10px" } },
          el("b", {}, `Deduction ${deductionIdx + 1}/${t.deductions.length}: `),
          `cell (${d.row + 1}, ${d.col + 1}) must be ${d.shaded ? "shaded" : "unshaded"}. `,
          el("span", { class: "badge" + (d.kind === "local" ? " badge-weak" : " badge-strong") }, d.kind)
        ),
        renderEvidence(d.evidence),
        renderZ3Proof(d)
      );
      if (deductionIdx === 0 && t.explanation) {
        if (explanationActive()) {
          panel.append(
            el(
              "div",
              { class: "flow-payload", style: { marginTop: "10px", display: "block" } },
              el("b", {}, "Local-model explanation "),
              el("span", { class: "muted" }, `(${t.explanationStatus ?? "not formally verified"}): `),
              t.explanation
            )
          );
        } else {
          panel.append(
            el(
              "div",
              { style: { marginTop: "10px", fontSize: "12px" } },
              el("span", { class: "muted" }, "The real explanation step only runs under Symbolic → Neural — switch the stacking pattern on the builder page to see it.")
            )
          );
        }
      }
    }
  }

  const EVIDENCE_PREVIEW = 8;

  function renderEvidence(evidence: string[]): HTMLElement {
    const shown = evidenceExpanded ? evidence : evidence.slice(0, EVIDENCE_PREVIEW);
    // overflowWrap/wordBreak here are what stop a long evidence line from
    // silently widening the whole debugger: CSS computes an ancestor's
    // fit-content width using each descendant's *unwrapped* line width, so
    // without this, whichever deduction currently has the longest evidence
    // line would nudge the whole page's width, and the width would visibly
    // drift wider/narrower as you stepped between deductions with different
    // evidence lengths -- see the matching note in liveLog.ts.
    //
    // A fixed height (not max-height) + its own scrollbar is what keeps the
    // whole deduction panel a consistent size regardless of which deduction is
    // showing -- a "local" deduction has as few as 3 evidence lines, a
    // "connectivity" one can have 30+. Without this, the panel (and everything
    // below it) would grow and shrink every time you stepped to a deduction of
    // a different kind.
    const list = el(
      "ul",
      { style: { marginTop: "6px", paddingLeft: "18px", height: "170px", overflowY: "auto" } },
      ...shown.map((line) => el("li", { style: { fontSize: "12px", overflowWrap: "anywhere", wordBreak: "break-word" } }, line))
    );
    const rest = evidence.length - EVIDENCE_PREVIEW;
    const toggle =
      rest > 0
        ? el(
            "button",
            { class: "btn", style: { padding: "3px 8px", fontSize: "11px" }, onclick: () => { evidenceExpanded = !evidenceExpanded; drawBody(); } },
            evidenceExpanded ? "Show fewer" : `Show all ${evidence.length} lines`
          )
        : "";
    return el("div", {}, list, toggle);
  }

  /** The plain-English evidence above is a gloss over a real Z3 unsat core: assigning
   * this cell the opposite value makes exactly these tracked assertions jointly
   * unsatisfiable (z3.Solver.unsat_core(), see standalone/puzzlelab/hitori.py:build/
   * run). Shown collapsed by default -- these are raw solver-internal names, not
   * meant to replace the English evidence, just to make the actual proof inspectable. */
  function renderZ3Proof(d: HitoriDeduction): HTMLElement {
    const toggle = el(
      "button",
      { class: "btn", style: { padding: "3px 8px", fontSize: "11px", marginTop: "6px" }, onclick: () => { proofExpanded = !proofExpanded; drawBody(); } },
      proofExpanded ? "Hide Z3 proof" : "Show Z3 proof"
    );
    if (!proofExpanded) return el("div", {}, toggle);
    const coreBox = el(
      "pre",
      {
        style: {
          marginTop: "6px",
          padding: "8px",
          fontSize: "11px",
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: "6px",
          overflowX: "auto",
          whiteSpace: "pre",
        },
      },
      `unsat core for shaded_${d.row}_${d.col} == ${!d.shaded}:\n` + d.constraint_ids.map((id) => `  ${id}`).join("\n")
    );
    // z3_proof/z3_proof_full_length are only present on traces the offline backfill
    // has already reached -- don't let a not-yet-backfilled trace throw mid-render
    // (which was blanking the whole panel) just because this field is missing.
    if (d.z3_proof == null) {
      return el(
        "div",
        {},
        toggle,
        coreBox,
        el(
          "div",
          { class: "muted", style: { fontSize: "11px", marginTop: "4px" } },
          "The full Z3 derivation isn't backfilled onto this trace yet -- showing the unsat core above in the meantime."
        )
      );
    }
    const truncated = d.z3_proof.length < d.z3_proof_full_length;
    const proofBox = el(
      "pre",
      {
        style: {
          marginTop: "10px",
          padding: "8px",
          fontSize: "10px",
          maxHeight: "300px",
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: "6px",
          overflow: "auto",
          whiteSpace: "pre",
        },
      },
      d.z3_proof + (truncated ? "\n\n... (still way more — see note below)" : "")
    );
    return el(
      "div",
      {},
      toggle,
      el(
        "div",
        { class: "muted", style: { fontSize: "11px", marginTop: "6px" } },
        "Above: which assertions conflict. Below: the actual proof of how."
      ),
      coreBox,
      proofBox,
      truncated
        ? el(
            "div",
            { class: "muted", style: { fontSize: "11px", marginTop: "4px" } },
            `Shown up to ${d.z3_proof.length.toLocaleString()} of ${d.z3_proof_full_length.toLocaleString()} characters -- connectivity-kind deductions genuinely produce proofs this large, so it trails off here.`
          )
        : ""
    );
  }

  function applyDeduction(t: HitoriTrace): void {
    if (deductionIdx < 0) return;
    // Apply every deduction up to and including this one, so stepping forward
    // shows the grid as the pipeline would have known it at that point.
    for (let i = 0; i <= deductionIdx; i++) {
      const d = t.deductions[i];
      shaded[d.row][d.col] = d.shaded;
    }
  }

  selectTrace(activeFile);
}
