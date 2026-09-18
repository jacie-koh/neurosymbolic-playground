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
          "nav",
          { class: "landing-nav" },
          el("img", { src: "/logo-mark.png", alt: "", class: "landing-nav-mark" }),
          el("span", { class: "landing-nav-title" }, "Neurosymbolic Playground")
        ),
        el(
          "section",
          { class: "landing-hero" },
          el(
            "h1",
            {},
            "Where neural",
            el("br"),
            "networks meet",
            el("br"),
            el("span", { class: "acid" }, "formal logic.")
          ),
          el(
            "p",
            {},
            "Five puzzles that show exactly how neural and symbolic approaches can be combined to improve results and explainability. Pick a puzzle and watch the pipeline run live."
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
