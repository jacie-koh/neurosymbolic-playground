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
    el("h2", {}, "Choose a puzzle"),
    el("p", {}, "Pick a problem where perception meets reasoning.")
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
      el("div", { class: "icon", html: s.icon }),
      el("h3", {}, s.title),
      el("p", { class: "tagline" }, s.tagline),
      el(
        "div",
        { class: "fit-card" },
        el("div", { class: "fit-card-label" }, "Symbolic fit"),
        el("div", { class: "fit-card-value" }, METHODS[s.suggestedMethod].label)
      ),
      s.howToPlayUrl
        ? el(
            "a",
            {
              class: "how-to-play",
              href: s.howToPlayUrl,
              target: "_blank",
              rel: "noopener noreferrer",
              onclick: (e: Event) => e.stopPropagation(),
            },
            "How to play ↗"
          )
        : null
    );
  });

  const chosen = getSituation(st.situationId);

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
      "Continue \u2192"
    ),
    !chosen ? el("span", { class: "muted" }, "Select a puzzle to continue") : null
  );

  root.append(head, el("div", { class: "card-grid" }, ...cards), cont);
}

