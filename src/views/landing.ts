/** Landing splash, shown once before the puzzle picker. */

import { store } from "../state";
import { el } from "../dom";

export function renderLanding(root: HTMLElement): void {
  root.append(
    el(
      "div",
      { class: "landing" },
      el("div", { class: "landing-grid-bg" }),
      el(
        "div",
        { class: "landing-content" },
        el(
          "section",
          { class: "landing-hero" },
          el("img", { src: "/logo-mark.png", alt: "", class: "landing-logo" }),
          el("div", { class: "landing-eyebrow" }, "Puzzle Playground"),
          el(
            "h1",
            {},
            "Explore",
            el("br"),
            el("span", { style: { whiteSpace: "nowrap" } }, "NeuralSymbolic Reasoning"),
            el("br"),
            "through ",
            el("span", { class: "acid" }, "Logic Puzzles")
          ),
          el(
            "p",
            {},
            "NeuroSymbolic Puzzle Playground lets you explore different ways neural and symbolic AI can work together through a collection of interactive puzzles. Try challenges involving logic, arithmetic, spatial, relational, and visual reasoning, and examine how different combinations of learning and reasoning lead to a solution."
          ),
          el(
            "button",
            { class: "landing-cta", onclick: () => store.set({ view: "situations" }) },
            "Explore the puzzles →"
          )
        ),
        el(
          "footer",
          { class: "landing-footer" },
          el(
            "div",
            { class: "landing-footer-brand" },
            el("img", { src: "/logo-mark.png", alt: "" }),
            el("span", {}, "Neurosymbolic Playground")
          ),
          el("span", {}, "MIT License")
        )
      )
    )
  );
}
