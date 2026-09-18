/**
 * Interactive Reasoning Debugger — Zebra / Einstein puzzle module.
 *
 * Reads real traces from the standalone backend: a local LLM (Qwen3-4B) translates
 * numbered natural-language clues into typed relations over category-qualified
 * entities, which the authors' Colored Exact Cover encoding solves via MINIEXACT.
 * See standalone/puzzlelab/zebra.py.
 *
 * The real parser does retry the LLM once if its JSON output fails schema
 * validation (re-prompted with the validator's error) — but that's a format
 * check on the LLM's own output, not the symbolic solver rejecting an
 * interpretation. MINIEXACT itself normally runs exactly once, with no
 * solver-conflict-driven re-parse loop — except for one curated example built
 * specifically to test this: puzzlelab.zebra.run_with_conflict_retry() really
 * re-prompts the LLM with the solver's own unsat result and re-solves from
 * scratch. See its conflictRetry field below, when present.
 *
 * Select a clue to see its structured interpretation, and edit its relation
 * (e.g. "left" -> "immediately_left") or target to see how the surviving
 * assignment changes. Edits rerun an exact client-side backtracking solve
 * (genericZebra.ts) — a separate, honest re-solve, not a replay of MINIEXACT.
 */

import { el, clear } from "../dom";
import { ZEBRA_TRACE_MANIFEST, loadZebraTrace, loadZebraManifest, type ZebraTrace, type ZebraManifestEntry, type ZebraClueRecord } from "../data/traces";
import { solveZebra, solveZebraWithSteps, explainRevealSteps, type Relation, type ZebraSolveStep, type ZebraStepReason } from "../neural/genericZebra";
import { renderLiveLog } from "./liveLog";
import { renderRandomizer } from "./randomizer";

const RELATIONS: Relation[] = [
  "at",
  "not_at",
  "same",
  "next_to",
  "left",
  "immediately_left",
  "right",
  "immediately_right",
  "distance",
];

function entityLabel(id: string): string {
  const value = id.split("@")[1] ?? id;
  return value.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Real category name (e.g. "Name", "MusicGenre") recovered from the puzzle's own
 * source, split into words -- falls back to the raw parser key ("g0") only for a
 * trace that predates groupLabels being backfilled. */
function groupLabel(t: ZebraTrace, g: string): string {
  const raw = t.groupLabels?.[g];
  if (!raw) return g;
  return raw.replace(/([a-z])([A-Z])/g, "$1 $2");
}

export function renderZebraDebugger(root: HTMLElement): void {
  clear(root);

  let activeFile = ZEBRA_TRACE_MANIFEST[0].file;
  let trace: ZebraTrace | null = null;
  let clues: ZebraClueRecord[] = [];
  let selectedIdx: number | null = null;
  let playing = false;
  let playTimer: ReturnType<typeof setTimeout> | undefined;
  let playSteps: ZebraSolveStep[] = [];
  let playIdx = 0;
  let livePositions: Record<string, number> | null = null;
  let logLines: string[] = [];

  function stopPlaying(): void {
    playing = false;
    if (playTimer !== undefined) {
      clearTimeout(playTimer);
      playTimer = undefined;
    }
  }

  // Replay/Step/output stay in one fixed block at the top of the page, above the
  // randomizer -- so they're never pushed around by (or push around) the clue
  // list/assignment grid below, and pressing Replay/Stop never shifts the page.
  const controlsHost = el("div");
  const randomizerHost = el("div");
  const body = el("div", { style: { marginTop: "16px" } });
  root.append(controlsHost, randomizerHost, body);

  /** Populated once the manifest loads, so drawBody() can look up this puzzle's real
   * offline-computed hasBacktrack/hasDeadClue/hasConflictRetry flags (see
   * standalone/reports/debugger/build_manifests.py) and surface them, not just
   * offer them as randomizer filters. */
  let manifestByFile = new Map<string, ZebraManifestEntry>();

  loadZebraManifest()
    .then((manifest) => {
      manifestByFile = new Map(manifest.map((e) => [e.file, e]));
      renderRandomizer<ZebraManifestEntry>(randomizerHost, manifest, {
        fields: [
          { key: "houses", label: "Houses", get: (e) => e.houses },
          { key: "hasBacktrack", label: "Backtracks", get: (e) => (e.hasBacktrack ? "yes" : "no") },
          { key: "hasDeadClue", label: "Dead clue", get: (e) => (e.hasDeadClue ? "yes" : "no") },
          { key: "hasConflictRetry", label: "Real conflict retry", get: (e) => (e.hasConflictRetry ? "yes" : "no") },
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
      if (trace) drawBody();
    })
    .catch(() => {
      randomizerHost.append(el("p", { class: "muted", style: { fontSize: "12px" } }, "Randomizer unavailable — couldn't load the example manifest."));
    });

  function selectTrace(file: string): void {
    stopPlaying();
    livePositions = null;
    logLines = [];
    playSteps = [];
    playIdx = 0;
    activeFile = file;
    selectedIdx = null;
    clear(body);
    body.append(el("p", { class: "muted" }, "Loading trace…"));
    loadZebraTrace(file)
      .then((t) => {
        trace = t;
        clues = t.clues.map((c) => ({ ...c }));
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

    const solve = solveZebra({ size: t.size, groups: t.groups, clues });
    const edited = clues.some((c, i) => JSON.stringify(c) !== JSON.stringify(t.clues[i]));

    const clueList = el("div", { style: { display: "flex", flexDirection: "column", gap: "8px", marginTop: "12px" } });
    clues.forEach((clue, i) => {
      const isSelected = selectedIdx === i;
      const changed = JSON.stringify(clue) !== JSON.stringify(t.clues[i]);
      clueList.append(
        el(
          "button",
          {
            class: "compound-token" + (isSelected ? " active" : ""),
            style: { width: "100%", alignItems: "stretch" },
            onclick: () => { stopPlaying(); selectedIdx = i; drawBody(); },
          },
          el("div", { class: "name" }, clue.source),
          el(
            "div",
            { class: "note", style: { marginTop: "4px", padding: "4px 8px" } },
            el("span", { class: "badge" + (changed ? " badge-strong" : " badge-weak") }, clue.relation),
            ` ${entityLabel(clue.a)}` +
              (clue.b ? ` ↔ ${entityLabel(clue.b)}` : "") +
              (clue.position != null ? ` @ house ${clue.position}` : "") +
              (clue.distance != null ? ` (distance ${clue.distance})` : "")
          )
        )
      );
    });

    const houses = Array.from({ length: t.size }, (_, i) => i + 1);
    const groupKeys = Object.keys(t.groups);
    const positions = livePositions ?? solve.solution;
    const grid = el("table", { class: "lab-grid", style: { display: "table", gridTemplateColumns: "none", borderCollapse: "collapse" } });
    const headRow = el("tr", {}, el("th", { style: cellStyle(true) }, "House"), ...groupKeys.map((g) => el("th", { style: cellStyle(true) }, groupLabel(t, g))));
    grid.append(headRow);
    for (const house of houses) {
      const row = el("tr", {}, el("td", { style: cellStyle(true) }, String(house)));
      for (const g of groupKeys) {
        const entity = t.groups[g].find((e) => positions?.[e] === house);
        row.append(el("td", { style: cellStyle(false) }, entity ? entityLabel(entity) : "—"));
      }
      grid.append(row);
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
              ? livePositions ? "▶ Replay the real verified answer" : "▶ Reveal the real verified answer"
              : livePositions ? "▶ Replay independent re-solve" : "▶ Watch independent re-solve (not MINIEXACT-verified)"
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
      livePositions ? el("span", { class: "muted", style: { fontSize: "12px", alignSelf: "center" } }, `step ${playIdx}/${playSteps.length || "?"}`) : ""
    );

    const status = el(
      "div",
      { class: "note", style: { marginTop: "16px" } },
      el("b", {}, "Client-side re-solve: "),
      solve.status === "sat"
        ? `satisfiable — a consistent assignment exists for all ${clues.length} clues shown above.`
        : `unsatisfiable — no assignment satisfies all ${clues.length} clues as currently edited.`,
      edited ? " (clue set edited — this no longer matches the offline pipeline's original interpretation.)" : ""
    );

    const meta = el(
      "div",
      { class: "flow-payload", style: { marginTop: "10px", display: "block" } },
      `${t.title} · ${t.size} houses, ${groupKeys.length} categories · offline pipeline result: ${t.result.status}` +
        (t.result.unique != null ? `, unique=${t.result.unique}` : "") +
        (t.parseAttempts
          ? t.parseAttempts > 1
            ? ` · LLM parse self-corrected: attempt 1's JSON failed schema validation, attempt ${t.parseAttempts} passed`
            : " · LLM parse succeeded on the first attempt, no schema-validation retry needed"
          : "")
    );

    // Real, offline-computed (build_manifests.py): removing this clue leaves the
    // OTHER clues still uniquely determining the exact same solution -- verified by
    // both re-solving without it AND confirming no second, different solution also
    // fits the remaining clues (a redundant clue and a genuinely under-constrained
    // puzzle can otherwise look identical to a deterministic search, since it'll
    // just find the same solution first either way). The solver itself never skips
    // or special-cases this clue -- MINIEXACT is given every clue exactly as
    // authored; "redundant" is a property discovered afterward, not something
    // solving does anything differently for.
    const manifestEntry = manifestByFile.get(activeFile);
    const deadClueIdx = manifestEntry?.deadClueIndex;
    const deadClueNote =
      manifestEntry?.hasDeadClue && deadClueIdx != null
        ? el(
            "div",
            { class: "note", style: { marginTop: "10px", borderLeft: "3px solid var(--accent)" } },
            el("span", { class: "badge badge-strong" }, "redundant clue"),
            ` clue ${deadClueIdx + 1} ("${t.clues[deadClueIdx].source}") is logically redundant here — every other clue together still pins down this exact solution uniquely, with or without it. ` +
              "The solver isn't given a chance to skip it or treat it specially -- it's included like every other clue; this redundancy is discovered by re-solving afterward, not acted on during solving."
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
          livePositions = null;
          logLines = [];
          playSteps = [];
          playIdx = 0;
          clues = t.clues.map((c) => ({ ...c }));
          selectedIdx = null;
          drawBody();
        },
      },
      "Reset to pipeline's interpretation"
    );

    const logBox = renderLiveLog(logLines);

    const conflictRetryPanel = t.conflictRetry
      ? el(
          "div",
          { class: "note", style: { marginTop: "16px", borderLeft: "3px solid var(--accent)" } },
          el("b", {}, "Real Neural ↔ Symbolic loop: "),
          `this puzzle's ${t.conflictRetry.attempts.length} attempts are all genuinely separate real parse+solve runs — attempt 1's actual solver result was fed back to the same local LLM as a new prompt, then re-parsed and re-solved from scratch.`,
          el(
            "ul",
            { style: { marginTop: "8px", paddingLeft: "18px" } },
            ...t.conflictRetry.attempts.map((a, i) =>
              el(
                "li",
                { style: { fontSize: "12.5px", marginBottom: "4px" } },
                el("b", {}, `Attempt ${i + 1}${i === 0 ? "" : " (after real solver-conflict feedback)"}: `),
                `solver status = ${a.status}`
              )
            )
          ),
          t.conflictRetry.attempts.every((a) => a.status !== "sat")
            ? el(
                "div",
                { style: { marginTop: "6px", fontSize: "12.5px", color: "var(--muted)" } },
                "Honest result: the retry didn't fix this particular puzzle — a real solver conflict fed back to the LLM doesn't guarantee a better re-parse. That's a genuine finding, not a bug in the loop."
              )
            : ""
        )
      : "";

    clear(controlsHost);
    controlsHost.append(playRow, stepRow, logBox);

    body.append(
      el("div", { style: { display: "flex", gap: "20px", flexWrap: "wrap", alignItems: "flex-start" } },
        el("div", { style: { flex: "1 1 320px" } }, el("h3", { style: { fontSize: "13px", margin: "0 0 4px" } }, "Clues"), clueList),
        el("div", { style: { flex: "1 1 260px" } }, el("h3", { style: { fontSize: "13px", margin: "0 0 4px" } }, "Assignment"), grid)
      ),
      meta,
      deadClueNote,
      conflictRetryPanel,
      status,
      panel,
      resetBtn
    );
  }

  /** True only when nothing's been edited and the offline MINIEXACT pass actually found an answer — the only case where there's a real, verified solution to show. */
  function canShowRealSolution(t: ZebraTrace): boolean {
    const edited = clues.some((c, i) => JSON.stringify(c) !== JSON.stringify(t.clues[i]));
    return !edited && t.result.status === "sat" && !!t.result.solution;
  }

  /** Whether the current playSteps reveal the real MINIEXACT-verified assignment
   * (entity by entity, not a live search -- the solver's own internal decision
   * process isn't recorded) rather than an independent client-side re-solve. */
  let revealMode = false;

  function prepareSteps(t: ZebraTrace): void {
    revealMode = canShowRealSolution(t);
    if (revealMode) {
      playSteps = explainRevealSteps({ size: t.size, groups: t.groups, clues: t.clues }, t.result.solution!);
    } else {
      // Edited clues (or the offline baseline itself was unsat): MINIEXACT never verified
      // this exact state, so fall back to an independent client-side search instead.
      playSteps = solveZebraWithSteps({ size: t.size, groups: t.groups, clues }).steps;
    }
    playIdx = 0;
  }

  function resetLive(): void {
    livePositions = {};
    logLines = [];
  }

  /** Renders a real ZebraStepReason (which houses were ruled out, and by what --
   * another entity already taking it, or a specific real clue by its actual source
   * text -- plus whichever houses aren't decided yet) into readable lines. */
  function explainLines(explain: ZebraStepReason): string[] {
    const lines: string[] = [];
    for (const r of explain.ruledOut) {
      if (r.takenBy) lines.push(`      house ${r.house}: already taken by ${entityLabel(r.takenBy)}`);
      else if (r.clue) lines.push(`      house ${r.house}: violates "${r.clue.source}"`);
      else lines.push(`      house ${r.house}: ruled out`);
    }
    if (explain.forced) {
      lines.unshift(`    forced — every other house is ruled out:`);
    } else if (explain.alsoLegal && explain.alsoLegal.length > 0) {
      const openLabel = revealMode ? "not yet decided by the clues revealed so far" : "still legal too — this is a guess, may backtrack";
      lines.push(`      house${explain.alsoLegal.length > 1 ? "s" : ""} ${explain.alsoLegal.join(", ")}: ${openLabel}`);
    }
    return lines;
  }

  /** O(1): applies exactly one more step during auto-play, so a fast-ticking (as low
   * as 15ms) backtracking trace with many steps stays responsive -- replaying from
   * scratch every tick was O(n) per tick (O(n^2) overall) and could bog the tab down
   * badly enough that the Stop button stopped registering clicks in time. */
  function applyStep(step: ZebraSolveStep): void {
    if (!livePositions) return;
    if (revealMode) {
      livePositions[step.entity] = step.house;
      logLines.push(`${entityLabel(step.entity)}: real verified house = ${step.house}`);
      if (step.explain) logLines.push(...explainLines(step.explain));
    } else if (step.deadEnd) {
      logLines.push(`dead end: ${entityLabel(step.entity)} — ${step.reason} — backtracking`);
    } else {
      if (step.house === 0) delete livePositions[step.entity];
      else livePositions[step.entity] = step.house;
      logLines.push(step.house ? `${entityLabel(step.entity)}: try house ${step.house}` : `${entityLabel(step.entity)}: backtrack`);
      if (step.house && step.explain) logLines.push(...explainLines(step.explain));
    }
  }

  /** O(n): only used for manual step-back/jump, which is infrequent -- replaying
   * from scratch is the only correct way to "undo" a backtrack step (house===0),
   * which doesn't carry the house it's reverting. */
  function applyStepsUpTo(n: number): void {
    resetLive();
    for (let i = 0; i < n; i++) applyStep(playSteps[i]);
  }

  function stepTo(t: ZebraTrace, idx: number): void {
    stopPlaying();
    if (playSteps.length === 0) prepareSteps(t);
    playIdx = Math.max(0, Math.min(playSteps.length, idx));
    applyStepsUpTo(playIdx);
    drawBody();
  }

  function playFrom(t: ZebraTrace): void {
    stopPlaying();
    prepareSteps(t);
    playing = true;
    resetLive();
    const delay = revealMode
      ? Math.max(120, Math.min(400, 3000 / Math.max(1, playSteps.length)))
      : Math.max(15, Math.min(120, 4000 / Math.max(1, playSteps.length)));
    // Capped re-render rate + batched steps per frame -- see sudokuDebugger.ts's
    // playFrom for why: rebuilding the whole clue/assignment view on every tick at a
    // tiny `delay` made the Stop button get torn down and recreated faster than
    // clicks could reliably land on it.
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

  function cellStyle(header: boolean): Record<string, string> {
    return {
      border: "1px solid var(--line)",
      padding: "6px 10px",
      fontSize: "12px",
      fontWeight: header ? "700" : "500",
      background: header ? "var(--panel)" : "transparent",
      textAlign: "center",
    };
  }

  function drawPanel(panel: HTMLElement, t: ZebraTrace): void {
    if (selectedIdx == null) {
      panel.append("Select a clue to edit its relation or target.");
      return;
    }
    const clue = clues[selectedIdx];
    const entities = Object.values(t.groups).flat();

    const relationSelect = el(
      "select",
      {
        onchange: (e: Event) => {
          stopPlaying();
          livePositions = null;
          const relation = (e.target as HTMLSelectElement).value as Relation;
          clue.relation = relation;
          if (relation === "at" || relation === "not_at") {
            delete clue.b;
            clue.position = clue.position ?? 1;
            delete clue.distance;
          } else if (relation === "distance") {
            delete clue.position;
            clue.b = clue.b ?? entities.find((x) => x !== clue.a);
            clue.distance = clue.distance ?? 1;
          } else {
            delete clue.position;
            delete clue.distance;
            clue.b = clue.b ?? entities.find((x) => x !== clue.a);
          }
          drawBody();
        },
      },
      ...RELATIONS.map((r) => el("option", { value: r, selected: r === clue.relation }, r))
    );

    const fields: HTMLElement[] = [el("div", {}, el("b", {}, "Relation: "), relationSelect)];

    if (clue.relation === "at" || clue.relation === "not_at") {
      fields.push(
        el(
          "div",
          { style: { marginTop: "8px" } },
          el("b", {}, "House: "),
          el("input", {
            type: "number",
            min: "1",
            max: String(t.size),
            value: String(clue.position ?? 1),
            style: { width: "60px" },
            onchange: (e: Event) => { stopPlaying(); livePositions = null; logLines = []; clue.position = Number((e.target as HTMLInputElement).value); drawBody(); },
          })
        )
      );
    } else {
      const bSelect = el(
        "select",
        {
          onchange: (e: Event) => { stopPlaying(); livePositions = null; logLines = []; clue.b = (e.target as HTMLSelectElement).value; drawBody(); },
        },
        ...entities.filter((x) => x !== clue.a).map((x) => el("option", { value: x, selected: x === clue.b }, entityLabel(x)))
      );
      fields.push(el("div", { style: { marginTop: "8px" } }, el("b", {}, "Target: "), bSelect));
      if (clue.relation === "distance") {
        fields.push(
          el(
            "div",
            { style: { marginTop: "8px" } },
            el("b", {}, "Distance: "),
            el("input", {
              type: "number",
              min: "0",
              max: String(t.size - 1),
              value: String(clue.distance ?? 1),
              style: { width: "60px" },
              onchange: (e: Event) => { stopPlaying(); livePositions = null; logLines = []; clue.distance = Number((e.target as HTMLInputElement).value); drawBody(); },
            })
          )
        );
      }
    }

    panel.append(
      el("div", {}, el("b", {}, "Original clue: "), `"${clue.source}"`),
      el("div", { style: { marginTop: "10px" } }, `About: ${entityLabel(clue.a)}`),
      ...fields
    );
  }

  selectTrace(activeFile);
}
