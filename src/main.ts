import "./style.css";
import { store, type ViewName } from "./state";
import { el, clear } from "./dom";
import { getSituation } from "./data/situations";
import { renderSituations } from "./views/situations";
import { renderResults } from "./views/results";

const app = document.querySelector<HTMLDivElement>("#app")!;

interface StepDef {
  view: ViewName;
  num: number;
  label: string;
}

const STEPS: StepDef[] = [
  { view: "situations", num: 1, label: "Puzzle" },
  { view: "results", num: 2, label: "Results" },
];

function canVisit(view: ViewName): boolean {
  const st = store.get();
  if (view === "situations") return true;
  // everything past step 1 needs a chosen situation
  return st.situationId != null;
}

function topbar(): HTMLElement {
  const st = store.get();

  const steps = STEPS.flatMap((s, i) => {
    const active = st.view === s.view;
    const stepEl = el(
      "div",
      {
        class: "step" + (active ? " active" : ""),
        onclick: () => {
          if (canVisit(s.view)) store.set({ view: s.view });
        },
      },
      el("span", { class: "num" }, String(s.num)),
      el("span", {}, s.label)
    );
    const sep =
      i < STEPS.length - 1 ? el("span", { class: "sep" }, "›") : null;
    return sep ? [stepEl, sep] : [stepEl];
  });

  return el(
    "header",
    { class: "topbar" },
    el("img", { src: "/logo-mark.png", alt: "", class: "brand-mark" }),
    el("h1", {}, "Neurosymbolic Playground"),
    el("div", { class: "stepper" }, ...steps),
    el("div", { class: "spacer" })
  );
}

function render(): void {
  const st = store.get();

  // Friendly guard: if a situation is required but missing, fall back.
  if (st.view !== "situations" && !getSituation(st.situationId)) {
    store.set({ view: "situations" });
    return;
  }

  clear(app);
  app.append(topbar());

  const container = el("main", { class: "view" });
  app.append(container);

  switch (st.view) {
    case "situations":
      renderSituations(container);
      break;
    case "results":
      renderResults(container);
      break;
  }
}

store.subscribe(render);
render();
