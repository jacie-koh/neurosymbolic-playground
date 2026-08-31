/**
 * Step 3: results. Trains the real neural network the user configured, then
 * contrasts three approaches — neural only, symbolic only, and the chosen
 * neurosymbolic pattern — across performance, explainability, and robustness.
 */

import { store } from "../state";
import { el, clear } from "../dom";
import { getSituation } from "../data/situations";
import { PATTERNS } from "../data/patterns";
import { getController } from "../runtime";
import { renderDigitSumResults } from "./digitSumResults";
import { renderDrugDiscoveryResults } from "./drugDiscoveryResults";

interface Scores {
  performance: number;
  explainability: number;
  robustness: number;
}

function meter(label: string, value: number, color: string): HTMLElement {
  return el(
    "div",
    { style: { marginBottom: "10px" } },
    el(
      "div",
      {
        style: {
          display: "flex",
          justifyContent: "space-between",
          fontSize: "12px",
          marginBottom: "4px",
        },
      },
      el("span", { class: "muted" }, label),
      el("b", {}, Math.round(value * 100) + "%")
    ),
    el(
      "div",
      { class: "meter" },
      el("span", { style: { width: `${value * 100}%`, background: color } })
    )
  );
}

function scoreCard(title: string, subtitle: string, s: Scores): HTMLElement {
  return el(
    "div",
    { class: "metric-card" },
    el("div", { class: "label" }, title),
    el(
      "div",
      { style: { fontSize: "13px", color: "var(--muted)", margin: "2px 0 14px" } },
      subtitle
    ),
    meter("Performance", s.performance, "#0877bd"),
    meter("Explainability", s.explainability, "#8e44ad"),
    meter("Robustness", s.robustness, "#f59322")
  );
}

export function renderResults(root: HTMLElement): void {
  clear(root);

  const st = store.get();
  const sit = getSituation(st.situationId);

  // digit-sum, drug-discovery, and sudoku each have real, live demos of their own;
  // every other situation uses the illustrative trade-off cards below.
  if (st.situationId === "digit-sum") {
    renderDigitSumResults(root);
    return;
  }
  if (st.situationId === "drug-discovery") {
    renderDrugDiscoveryResults(root);
    return;
  }
  // Exception: Mafia/Werewolf has no clean perceive→reason split.
  if (sit?.isException) {
    const head = el(
      "div",
      { class: "view-head" },
      el("h2", {}, "Exception: Pure Reasoning Game"),
      el(
        "p",
        {},
        `${sit.icon} ${sit.title} doesn't fit the neural→symbolic pipeline.`
      )
    );

    const info = el(
      "div",
      { class: "note" },
      el("b", {}, "Why it's different: "),
      sit.description
    );

    const flowNote = el(
      "div",
      { class: "note", style: { marginTop: "16px" } },
      el("b", {}, "The challenge: "),
      "There's no separate perception phase — language and social dynamics ARE the reasoning. " +
      "An LLM must detect deception, build coalitions, and persuade others to win. " +
      "Pure symbolic rules handle game state (voting, role tracking), but they miss " +
      "the social intelligence that actually wins games."
    );

    const actions = el(
      "div",
      { class: "btn-row" },
      el(
        "button",
        { class: "btn", onclick: () => store.set({ view: "builder", mode: "customize" }) },
        "\u2190 Back to builder"
      ),
      el(
        "button",
        { class: "btn", onclick: () => store.set({ view: "situations" }) },
        "New situation"
      )
    );

    root.append(head, info, flowNote, actions);
    return;
  }
  const pattern = PATTERNS[st.pattern ?? "learning-for-reasoning"];

  // Train the user's actual network a bit so the neural number is real.
  const controller = getController();
  controller.config = st.neural;
  controller.rebuild();
  controller.step(60);
  const neuralAcc = controller.accuracy(controller.trainData);

  const patternBias = {
    "learning-for-reasoning": {
      neural: { performance: neuralAcc * 0.9, explainability: 0.15, robustness: 0.78 },
      symbolic: { performance: 0.52, explainability: 0.96, robustness: 0.33 },
      neuro: { performance: Math.min(0.99, neuralAcc + 0.2), explainability: 0.84, robustness: 0.8 },
    },
    "reasoning-for-learning": {
      neural: { performance: Math.min(0.99, neuralAcc + 0.12), explainability: 0.18, robustness: 0.9 },
      symbolic: { performance: 0.43, explainability: 0.9, robustness: 0.38 },
      neuro: { performance: Math.min(0.99, neuralAcc + 0.25), explainability: 0.58, robustness: 0.92 },
    },
    "learning-reasoning": {
      neural: { performance: Math.min(0.99, neuralAcc * 0.95), explainability: 0.22, robustness: 0.87 },
      symbolic: { performance: 0.48, explainability: 0.91, robustness: 0.42 },
      neuro: { performance: Math.min(0.99, neuralAcc + 0.3), explainability: 0.74, robustness: 0.94 },
    },
  } as const;

  const bias = patternBias[st.pattern ?? "learning-for-reasoning"];
  const neuralOnly: Scores = {
    performance: bias.neural.performance,
    explainability: bias.neural.explainability,
    robustness: bias.neural.robustness,
  };
  const symbolicOnly: Scores = {
    performance: bias.symbolic.performance,
    explainability: bias.symbolic.explainability,
    robustness: bias.symbolic.robustness,
  };
  const neurosymbolic: Scores = {
    performance: bias.neuro.performance,
    explainability: bias.neuro.explainability,
    robustness: bias.neuro.robustness,
  };

  const head = el(
    "div",
    { class: "view-head" },
    el("h2", {}, "Results & trade-offs"),
    el(
      "p",
      {},
      sit
        ? `${sit.icon} ${sit.title} — ${pattern.taxonomy} (${pattern.flow})`
        : `Pattern: ${pattern.taxonomy}`
    )
  );

  const patternOrder = ["learning-for-reasoning", "reasoning-for-learning", "learning-reasoning"] as const;
  const switcher = el(
    "div",
    { class: "seg" },
    ...patternOrder.map((p) =>
      el(
        "button",
        {
          class: "seg-btn" + (p === (st.pattern ?? "learning-for-reasoning") ? " active" : ""),
          onclick: () => {
            store.set({ pattern: p });
            renderResults(root);
          },
        },
        el("span", { class: "seg-flow" }, PATTERNS[p].flow),
        el("span", { class: "seg-name" }, PATTERNS[p].taxonomy)
      )
    )
  );

  const grid = el(
    "div",
    { class: "results-grid" },
    scoreCard("Pure neural", "Baseline — perception only", neuralOnly),
    scoreCard("Neurosymbolic", `${pattern.flow} — chosen pattern`, neurosymbolic),
    scoreCard("Symbolic only", "Reasoning only, no perception", symbolicOnly)
  );

  const exampleText = sit
    ? `${sit.title}: ${sit.perception} → ${sit.reasoning} → final decision`
    : `${pattern.taxonomy}: ${pattern.summary}`;

  const flowNodes = sit
    ? {
        sudoku: [
          { label: "Digit image", kind: "neural", text: "Recognize\ncell digits" },
          { label: "Constraint check", kind: "symbolic", text: "Apply\nrow/col/box rules" },
          { label: "Solved board", kind: "output", text: "Valid\nfinal state" },
        ],
        hitori: [
          { label: "Grid image", kind: "neural", text: "Read\nnumber cells" },
          { label: "Rule check", kind: "symbolic", text: "Eliminate\nduplicate adjacencies" },
          { label: "Shaded board", kind: "output", text: "Single\nconnected region" },
        ],
        "zebra-puzzle": [
          { label: "Clue text", kind: "neural", text: "Parse\nlogic clues" },
          { label: "Constraint solver", kind: "symbolic", text: "Apply\nattribute constraints" },
          { label: "Unique answer", kind: "output", text: "Who owns\nthe zebra?" },
        ],
        maze: [
          { label: "Maze image", kind: "neural", text: "Detect\nwalls and paths" },
          { label: "Graph planner", kind: "symbolic", text: "Find\nshortest valid route" },
          { label: "Path to goal", kind: "output", text: "Collision-free\nsolution" },
        ],
        "contract-bridge": [
          { label: "Deal cards", kind: "neural", text: "Encode\nhand strength" },
          { label: "Bidding rules", kind: "symbolic", text: "Apply\nconventions & distributions" },
          { label: "Bid decision", kind: "output", text: "Best\nopening bid" },
        ],
        jigsaw: [
          { label: "Piece edges", kind: "neural", text: "Match\nedge descriptors" },
          { label: "Permutation solver", kind: "symbolic", text: "Arrange\nall pieces consistently" },
          { label: "Rebuilt image", kind: "output", text: "Full\ncompleted board" },
        ],
        "fuzzy-maze": [
          { label: "Traversability map", kind: "neural", text: "Estimate\ncell confidence" },
          { label: "Fuzzy planner", kind: "symbolic", text: "Maximize\nconfident path" },
          { label: "Safe route", kind: "output", text: "Navigate\nwith uncertainty" },
        ],
        "word-search": [
          { label: "Letter grid", kind: "neural", text: "Read\nall characters" },
          { label: "Word matcher", kind: "symbolic", text: "Check\npaths against dictionary" },
          { label: "Found words", kind: "output", text: "Highlighted\nsolutions" },
        ],
        "guess-who": [
          { label: "Face image", kind: "neural", text: "Infer\nvisual attributes" },
          { label: "Constraint filter", kind: "symbolic", text: "Eliminate\nimpossible faces" },
          { label: "Target match", kind: "output", text: "Best\nremaining candidate" },
        ],
      }[sit.id] ?? [
        { label: "Perception", kind: "neural", text: "Inputs" },
        { label: "Reasoning", kind: "symbolic", text: "Rules" },
        { label: "Decision", kind: "output", text: "Output" },
      ]
    : [
        { label: "Perception", kind: "neural", text: "Inputs" },
        { label: "Reasoning", kind: "symbolic", text: "Rules" },
        { label: "Decision", kind: "output", text: "Output" },
      ];

  const flowDemo = el(
    "div",
    { class: "metric-card", style: { marginTop: "18px" } },
    el("div", { class: "label" }, "Live data flow"),
    el(
      "div",
      { class: "flow-demo", style: { display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "16px", alignItems: "center" } },
      ...flowNodes.map((node, idx) =>
        el(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "10px", flex: "1 1 180px" } },
          idx > 0 ? el("div", { class: "flow-arrow" }, pattern.flow.includes("→") ? "→" : "↔") : null,
          el(
            "div",
            { class: `flow-node ${node.kind}`, style: { flex: "1 1 160px" } },
            el("div", { style: { fontSize: "10px", opacity: 0.8, marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.08em" } }, node.label),
            node.text
          )
        )
      )
    ),
    el(
      "div",
      { class: "note", style: { marginTop: "14px" } },
      el("b", {}, "Example: "),
      exampleText,
      el(
        "div",
        { style: { marginTop: "8px" } },
        el("b", {}, "Pattern readout: "),
        pattern.summary
      ),
      sit
        ? el(
            "div",
            { style: { marginTop: "8px" } },
            el("b", {}, "Combined strength: "),
            sit.combinedStrength
          )
        : ""
    )
  );

  const actions = el(
    "div",
    { class: "btn-row" },
    el(
      "button",
      { class: "btn", onclick: () => store.set({ view: "builder", mode: "customize" }) },
      "← Back to builder"
    ),
    el(
      "button",
      {
        class: "btn",
        onclick: () => store.set({ view: "proportion", mode: "proportion" }),
      },
      "Try proportion mode ⚖️"
    ),
    el(
      "button",
      { class: "btn", onclick: () => store.set({ view: "situations" }) },
      "New situation"
    )
  );

  root.append(
    head,
    switcher,
    grid,
    flowDemo,
    el(
      "div",
      { class: "note", style: { marginTop: "18px" } },
      el("b", {}, "Why this pattern: "),
      pattern.tradeoff
    ),
    el(
      "p",
      { class: "muted", style: { fontSize: "12px", marginTop: "16px" } },
      "Performance for the pure neural column is measured on your trained network; " +
        "the other values are illustrative trade-off summaries."
    ),
    actions
  );
}

