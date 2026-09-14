/** Step 1: pick a situation. */

import { store } from "../state";
import { el } from "../dom";
import { SITUATIONS, getSituation } from "../data/situations";
import { METHODS } from "../data/patterns";

export function renderSituations(root: HTMLElement): void {
  const st = store.get();

  const head = el(
    "div",
    { class: "view-head" },
    el("h2", {}, "Choose a situation"),
    el(
      "p",
      {},
      "Pick a problem where perception meets reasoning. Each one highlights a " +
        "different symbolic method and shows where neural and symbolic differ."
    )
  );

  const cards = SITUATIONS.map((s) => {
    const selected = st.situationId === s.id;
    return el(
      "div",
      {
        class: "situation-card" + (selected ? " selected" : ""),
        onclick: () => {
          // selecting a situation also seeds its suggested method + pattern
          store.setSymbolic({ method: s.suggestedMethod });
          store.set({ situationId: s.id, pattern: s.suggestedPattern });
        },
      },
      el("div", { class: "icon" }, s.icon),
      el("h3", {}, s.title),
      el("p", { class: "tagline" }, s.tagline),
      el(
        "p",
        { class: "tagline", style: { fontSize: "12px" } },
        `Symbolic fit: ${METHODS[s.suggestedMethod].label}`
      )
    );
  });

  const chosen = getSituation(st.situationId);
  const detail = chosen
    ? el(
        "div",
        { class: "note", style: { marginTop: "20px" } },
        el("b", {}, chosen.title + " — "),
        chosen.description
      )
    : null;

  const cont = el(
    "div",
    { class: "btn-row" },
    el(
      "button",
      {
        class: "btn primary",
        disabled: !chosen,
        onclick: () => store.set({ view: "results" }),
      },
      "See real results \u2192"
    ),
    !chosen ? el("span", { class: "muted" }, "Select a situation to continue") : null
  );

  root.append(head, el("div", { class: "card-grid" }, ...cards), detail ?? "", cont);
}

