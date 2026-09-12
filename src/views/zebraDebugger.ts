/**
 * Interactive Reasoning Debugger — Zebra / Einstein puzzle module.
 *
 * Reads real traces from the standalone backend: a local LLM (Qwen3-4B) translates
 * numbered natural-language clues into typed relations over category-qualified
 * entities, which the authors' Colored Exact Cover encoding solves via MINIEXACT.
 * See standalone/puzzlelab/zebra.py.
 *
 * Select a clue to see its structured interpretation, and edit its relation
 * (e.g. "left" -> "immediately_left") or target to see how the surviving
 * assignment changes. Edits rerun an exact client-side backtracking solve
 * (genericZebra.ts) — a separate, honest re-solve, not a replay of MINIEXACT.
 */

import { el, clear } from "../dom";
import { ZEBRA_TRACE_MANIFEST, loadZebraTrace, type ZebraTrace, type ZebraClueRecord } from "../data/traces";
import { solveZebra, solveZebraWithSteps, type Relation } from "../neural/genericZebra";
import { renderLiveLog } from "./liveLog";

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

export function renderZebraDebugger(root: HTMLElement): void {
  clear(root);

  let activeFile = ZEBRA_TRACE_MANIFEST[0].file;
  let trace: ZebraTrace | null = null;
  let clues: ZebraClueRecord[] = [];
  let selectedIdx: number | null = null;
  let playing = false;
  let playTimer: ReturnType<typeof setTimeout> | undefined;
  let playSteps: { entity: string; house: number }[] = [];
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

  const picker = el("div", { class: "seg" });
  const body = el("div", { style: { marginTop: "16px" } });
  root.append(picker, body);

  function selectTrace(file: string): void {
    stopPlaying();
    livePositions = null;
    logLines = [];
    activeFile = file;
    selectedIdx = null;
    clear(body);
    body.append(el("p", { class: "muted" }, "Loading trace…"));
    loadZebraTrace(file)
      .then((t) => {
        trace = t;
        clues = t.clues.map((c) => ({ ...c }));
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
    for (const entry of ZEBRA_TRACE_MANIFEST) {
      const houses = entry.id.match(/(\d+)house/)?.[1];
      picker.append(
        el(
          "button",
          { class: "seg-btn" + (entry.file === activeFile ? " active" : ""), onclick: () => selectTrace(entry.file) },
          el("span", { class: "seg-flow" }, entry.id.replace(/^zebra-/, "").replace(/-/g, " ")),
          el("span", { class: "seg-name" }, houses ? `${houses} houses` : "")
        )
      );
    }
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
    const headRow = el("tr", {}, el("th", { style: cellStyle(true) }, "House"), ...groupKeys.map((g) => el("th", { style: cellStyle(true) }, g)));
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
        : el("button", { class: "btn primary", onclick: () => playFrom(t) }, livePositions ? "▶ Replay solve in real time" : "▶ Watch it solve in real time"),
      playing
        ? el("span", { class: "muted", style: { fontSize: "12px", alignSelf: "center" } }, `solving… step ${playIdx}/${playSteps.length}`)
        : ""
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
        (t.result.unique != null ? `, unique=${t.result.unique}` : "")
    );

    const panel = el("div", { class: "note", style: { marginTop: "16px" } });
    drawPanel(panel, t);

    const resetBtn = el(
      "button",
      {
        class: "btn",
        style: { marginTop: "12px" },
        onclick: () => { stopPlaying(); livePositions = null; logLines = []; clues = t.clues.map((c) => ({ ...c })); selectedIdx = null; drawBody(); },
      },
      "Reset to pipeline's interpretation"
    );

    const logBox = renderLiveLog(logLines);

    body.append(
      el("div", { style: { display: "flex", gap: "20px", flexWrap: "wrap", alignItems: "flex-start" } },
        el("div", { style: { flex: "1 1 320px" } }, el("h3", { style: { fontSize: "13px", margin: "0 0 4px" } }, "Clues"), clueList),
        el("div", { style: { flex: "1 1 260px" } }, el("h3", { style: { fontSize: "13px", margin: "0 0 4px" } }, "Assignment"), grid)
      ),
      meta,
      playRow,
      logBox,
      status,
      panel,
      resetBtn
    );
  }

  function playFrom(t: ZebraTrace): void {
    stopPlaying();
    const result = solveZebraWithSteps({ size: t.size, groups: t.groups, clues });
    playSteps = result.steps;
    playIdx = 0;
    livePositions = {};
    logLines = [];
    playing = true;
    const delay = Math.max(15, Math.min(120, 4000 / Math.max(1, playSteps.length)));
    const tick = () => {
      if (!playing) return;
      if (playIdx >= playSteps.length) {
        playing = false;
        drawBody();
        return;
      }
      const step = playSteps[playIdx];
      if (livePositions) {
        if (step.house === 0) delete livePositions[step.entity];
        else livePositions[step.entity] = step.house;
      }
      logLines.push(step.house ? `${entityLabel(step.entity)}: try house ${step.house}` : `${entityLabel(step.entity)}: backtrack`);
      playIdx++;
      drawBody();
      playTimer = setTimeout(tick, delay);
    };
    drawBody();
    playTimer = setTimeout(tick, delay);
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

  drawPicker();
  selectTrace(activeFile);
}
