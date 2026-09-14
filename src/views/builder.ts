/** Step 2: build the architecture (neural block + symbolic block + stacking). */

import { store, type StackingPattern } from "../state";
import { el } from "../dom";
import { getSituation } from "../data/situations";
import { PATTERNS, PATTERN_ORDER, METHODS } from "../data/patterns";
import { isPatternRemoved } from "./realResults";

/** A small static sketch of a neural net for the collapsed block preview. */
function miniNeural(): SVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 120 70");
  svg.setAttribute("width", "120");
  svg.setAttribute("height", "70");
  const cols = [
    [18, [18, 52]],
    [60, [12, 35, 58]],
    [102, [35]],
  ] as [number, number[]][];
  // links
  for (let c = 0; c < cols.length - 1; c++) {
    const [x1, ys1] = cols[c];
    const [x2, ys2] = cols[c + 1];
    for (const y1 of ys1)
      for (const y2 of ys2) {
        const line = document.createElementNS(ns, "line");
        line.setAttribute("x1", String(x1));
        line.setAttribute("y1", String(y1));
        line.setAttribute("x2", String(x2));
        line.setAttribute("y2", String(y2));
        line.setAttribute("stroke", Math.random() > 0.5 ? "#0877bd" : "#f59322");
        line.setAttribute("stroke-width", "1");
        line.setAttribute("opacity", "0.6");
        svg.appendChild(line);
      }
  }
  // nodes
  for (const [x, ys] of cols)
    for (const y of ys) {
      const r = document.createElementNS(ns, "rect");
      r.setAttribute("x", String(x - 6));
      r.setAttribute("y", String(y - 6));
      r.setAttribute("width", "12");
      r.setAttribute("height", "12");
      r.setAttribute("rx", "3");
      r.setAttribute("fill", "#fff");
      r.setAttribute("stroke", "#0877bd");
      svg.appendChild(r);
    }
  return svg;
}

function neuralBlock(): HTMLElement {
  const st = store.get();
  const sit = getSituation(st.situationId);
  const disabled = !!sit?.isException;
  const layers = [st.neural.features.length, ...st.neural.hiddenLayers, 1];

  return el(
    "div",
    {
      class: "block neural" + (disabled ? " disabled" : ""),
      draggable: !disabled,
      "data-kind": "neural",
      title: sit?.isException
        ? "Not applicable for this exception situation"
        : "Double-click to customize the neural network",
      ondblclick: () => {
        if (!disabled) store.set({ view: "neural" });
      },
    },
    el(
      "div",
      { class: "block-head" },
      el("span", {}, "\uD83E\uDDE0 Neural"),
      el("span", { class: "tag" }, "perception")
    ),
    el("div", { class: "mini" }, miniNeural()),
    el(
      "div",
      { class: "hint" },
      `${layers.join("-")} \u00B7 ${st.neural.activation} \u00B7 double-click to edit`
    )
  );
}

function symbolicBlock(): HTMLElement {
  const st = store.get();
  const sit = getSituation(st.situationId);
  const disabled = !!sit?.isException;
  // Fixed per situation — the user can inspect it but not swap it.
  const m = METHODS[sit?.suggestedMethod ?? st.symbolic.method];

  return el(
    "div",
    {
      class: "block symbolic" + (disabled ? " disabled" : ""),
      draggable: !disabled,
      "data-kind": "symbolic",
      title: sit?.isException
        ? "Not applicable for this exception situation"
        : "Double-click to see how this symbolic method works",
      ondblclick: () => {
        if (!disabled) store.set({ view: "symbolic" });
      },
    },
    el(
      "div",
      { class: "block-head" },
      el("span", {}, "\uD83D\uDD23 Symbolic"),
      el("span", { class: "tag" }, "reasoning")
    ),
    el(
      "div",
      { class: "mini", style: { flexDirection: "column", gap: "4px" } },
      el("div", { style: { fontSize: "26px" } }, m.icon),
      el("div", { style: { fontSize: "12px", color: "#555" } }, m.label)
    ),
    el("div", { class: "hint" }, `${m.io} \u00B7 double-click for details`)
  );
}

function connector(pattern: StackingPattern): HTMLElement {
  const symbol =
    pattern === "learning-reasoning"
      ? "\u2194"
      : pattern === "reasoning-for-learning"
      ? "\u2192"
      : "\u2192";
  return el("div", { class: "connector" }, symbol);
}

/** Order the two blocks on the canvas according to the stacking pattern. */
function canvas(): HTMLElement {
  const st = store.get();
  const sit = getSituation(st.situationId);
  const pattern = st.pattern ?? "learning-reasoning";

  const neural = neuralBlock();
  const symbolic = symbolicBlock();

  // Default left-to-right is Neural -> Symbolic. For reasoning-for-learning we
  // reverse so the symbolic knowledge visibly feeds the network.
  const reverse = pattern === "reasoning-for-learning";
  const first = reverse ? symbolic : neural;
  const second = reverse ? neural : symbolic;

  const row = el(
    "div",
    { class: "flow-row" },
    first,
    connector(pattern),
    second
  );

  enableDragSwap(row);

  const hint = sit?.isException
    ? el(
        "p",
        { class: "muted", style: { margin: "0 0 16px", fontSize: "13px", color: "#d9534f" } },
        "⚠️  This situation is an exception: there's no clean separation between " +
          "perception and reasoning. The flow shown is illustrative only."
      )
    : el(
        "p",
        { class: "muted", style: { margin: "0 0 16px", fontSize: "13px" } },
        "Drag a block to swap the order, or pick a pattern on the right. " +
          "Double-click the neural block to customize it; double-click the " +
          "symbolic block to see how it reasons."
      );

  return el(
    "div",
    { class: "canvas" },
    hint,
    row
  );
}

/** Minimal drag-and-drop: dropping one block on the other swaps their order. */
function enableDragSwap(row: HTMLElement): void {
  let dragKind: string | null = null;
  row.querySelectorAll<HTMLElement>(".block").forEach((block) => {
    block.addEventListener("dragstart", (e) => {
      dragKind = block.dataset.kind ?? null;
      block.classList.add("dragging");
      e.dataTransfer?.setData("text/plain", dragKind ?? "");
    });
    block.addEventListener("dragend", () => block.classList.remove("dragging"));
    block.addEventListener("dragover", (e) => {
      e.preventDefault();
      block.classList.add("drop-target");
    });
    block.addEventListener("dragleave", () =>
      block.classList.remove("drop-target")
    );
    block.addEventListener("drop", (e) => {
      e.preventDefault();
      block.classList.remove("drop-target");
      const target = block.dataset.kind;
      if (!dragKind || dragKind === target) return;
      // Swapping picks the directional pattern based on who ends up first.
      // Drop neural onto symbolic => neural leads => learning-for-reasoning.
      const pattern: StackingPattern =
        dragKind === "neural"
          ? "learning-for-reasoning"
          : "reasoning-for-learning";
      store.set({ pattern });
    });
  });
}

function patternChooser(): HTMLElement {
  const st = store.get();
  const opts = PATTERN_ORDER.filter((id) => !isPatternRemoved(st.situationId, id)).map((id) => {
    const p = PATTERNS[id];
    return el(
      "div",
      {
        class: "pattern-opt" + (st.pattern === id ? " selected" : ""),
        onclick: () => store.set({ pattern: id }),
      },
      el("div", { class: "flow" }, p.flow),
      el("div", { class: "taxo" }, p.taxonomy),
      el("div", { class: "sum" }, p.summary)
    );
  });
  return el(
    "div",
    { class: "panel" },
    el("h4", {}, "Stacking pattern"),
    el("div", { class: "pattern-list" }, ...opts)
  );
}

export function renderBuilder(root: HTMLElement): void {
  const st = store.get();
  const sit = getSituation(st.situationId);

  const head = el(
    "div",
    { class: "view-head" },
    el("h2", {}, "Build the architecture"),
    el(
      "p",
      {},
      sit
        ? `${sit.icon} ${sit.title} — combine a neural perceiver with a symbolic reasoner.`
        : "Combine a neural perceiver with a symbolic reasoner."
    )
  );

  const grid = el("div", { class: "builder" }, canvas(), patternChooser());

  const actions = el(
    "div",
    { class: "btn-row" },
    el(
      "button",
      { class: "btn", onclick: () => store.set({ view: "situations" }) },
      "\u2190 Back"
    ),
    el(
      "button",
      {
        class: "btn primary",
        onclick: () => store.set({ view: "results" }),
      },
      "Run & see results \u2192"
    ),
    el(
      "span",
      { class: "muted", style: { fontSize: "13px" } },
      "Tip: the neural\u2194symbolic proportion lives in its own mode (top right)."
    )
  );

  root.append(head, grid, actions);
}

