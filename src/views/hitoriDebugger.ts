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
  root.append(randomizerHost, body);

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

    const grid = el("div", { class: "lab-grid", style: { gridTemplateColumns: `repeat(${t.grid[0].length}, 52px)` } });
    t.grid.forEach((row, r) =>
      row.forEach((value, c) => {
        const key = cellKey(r, c);
        const isShaded = shaded[r][c];
        let background = "var(--panel)";
        let color = "inherit";
        if (key === deducedCell) { background = "#0877bd"; color = "#fff"; }
        else if (highlighted.has(key)) { background = "#eef5fb"; }
        else if (isShaded) { background = "#263238"; color = "#fff"; }
        else if (dupCells.has(key) || adjCells.has(key)) { background = "#fdecec"; color = "#b3261e"; }

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

    const issues = [
      violations.duplicates.length ? `${violations.duplicates.length / 2 | 0} duplicate pair(s) among unshaded cells` : "",
      violations.adjacentShaded.length ? `${violations.adjacentShaded.length / 2 | 0} adjacent shaded pair(s)` : "",
      violations.disconnected ? "unshaded cells are not all connected" : "",
    ].filter(Boolean);
    const solvedMatch = t.solution && JSON.stringify(shaded) === JSON.stringify(t.solution);
    const status = el(
      "div",
      { class: "note", style: { marginTop: "16px" } },
      el("b", {}, "Rule check: "),
      issues.length ? issues.join("; ") + "." : solvedMatch ? "matches the verified unique solution." : "no violations yet — keep going.",
      solveMessage ? el("div", { style: { marginTop: "6px" } }, solveMessage) : ""
    );

    const logLines =
      deductionIdx >= 0
        ? t.deductions
            .slice(0, deductionIdx + 1)
            .map((d, i) => `${i + 1}. (${d.row + 1},${d.col + 1}) forced ${d.shaded ? "shaded" : "unshaded"} — ${d.kind}`)
        : [];
    const logBox = renderLiveLog(logLines);

    const deductionPanel = el("div", { class: "note", style: { marginTop: "16px" } });
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

    body.append(grid, status, deductionPanel, logBox, controls);
  }

  function stepForward(t: HitoriTrace): boolean {
    if (deductionIdx < 0) {
      shaded = t.grid.map((row) => row.map(() => false));
      locked = new Set();
    }
    if (deductionIdx >= t.deductions.length - 1) return false;
    deductionIdx = deductionIdx < 0 ? 0 : deductionIdx + 1;
    evidenceExpanded = false;
    applyDeduction(t);
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
    const playRow = el(
      "div",
      { class: "btn-row" },
      playing
        ? el(
            "button",
            { class: "btn primary", onclick: () => { stopPlaying(); drawBody(); } },
            "⏸ Stop"
          )
        : el(
            "button",
            { class: "btn primary", onclick: () => playFrom(t) },
            deductionIdx >= 0 ? "▶ Replay solve in real time" : "▶ Watch it solve in real time"
          ),
      playing
        ? el("span", { class: "muted", style: { fontSize: "12px", alignSelf: "center" } }, `solving… ${Math.max(deductionIdx + 1, 0)}/${t.deductions.length}`)
        : ""
    );
    const nav = el(
      "div",
      { class: "btn-row", style: { marginTop: "8px" } },
      el(
        "button",
        {
          class: "btn",
          disabled: playing || deductionIdx <= 0,
          onclick: () => { deductionIdx = Math.max(0, deductionIdx - 1); evidenceExpanded = false; applyDeduction(t); drawBody(); },
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
            applyDeduction(t);
            drawBody();
          },
        },
        deductionIdx < 0 ? "Step through one deduction →" : "Next deduction →"
      )
    );
    panel.append(
      el("div", {}, el("b", {}, "Step-through: "), `${t.deductions.length} cells are forced, ranked local-first.`),
      playRow,
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
        renderEvidence(d.evidence)
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
    const list = el(
      "ul",
      { style: { marginTop: "6px", paddingLeft: "18px" } },
      ...shown.map((line) => el("li", { style: { fontSize: "12px" } }, line))
    );
    const rest = evidence.length - EVIDENCE_PREVIEW;
    const toggle =
      rest > 0
        ? el(
            "button",
            { class: "btn", style: { padding: "3px 8px", fontSize: "11px" }, onclick: () => { evidenceExpanded = !evidenceExpanded; drawBody(); } },
            evidenceExpanded ? "Show fewer" : `Show all ${evidence.length} (this cell's unsat core grew as more of the grid became known)`
          )
        : "";
    return el("div", {}, list, toggle);
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
