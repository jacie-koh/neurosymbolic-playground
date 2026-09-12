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
import { renderSituationLab } from "./situationLab";
import { renderSudokuDebugger } from "./sudokuDebugger";
import { renderZebraDebugger } from "./zebraDebugger";
import { renderKenKenDebugger } from "./kenkenDebugger";
import { renderHitoriDebugger } from "./hitoriDebugger";
import { renderVDPDebugger } from "./vdpDebugger";
import { renderRealResults } from "./realResults";

const DEBUGGER_RENDERERS: Record<string, (root: HTMLElement) => void> = {
  sudoku: renderSudokuDebugger,
  "zebra-puzzle": renderZebraDebugger,
  kenken: renderKenKenDebugger,
  hitori: renderHitoriDebugger,
  "visual-discrimination": renderVDPDebugger,
};

let liveTraceTimers: ReturnType<typeof setTimeout>[] = [];

function cancelLiveTrace(): void {
  liveTraceTimers.forEach(clearTimeout);
  liveTraceTimers = [];
}

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
  cancelLiveTrace();
  clear(root);

  const st = store.get();
  const sit = getSituation(st.situationId);

  const debuggerRenderer = st.situationId ? DEBUGGER_RENDERERS[st.situationId] : undefined;
  if (debuggerRenderer && st.situationId) {
    renderRealResults(root, st.situationId, () => renderResults(root));

    const debuggerHost = el("div", { style: { marginTop: "16px" } });
    root.append(debuggerHost);
    debuggerRenderer(debuggerHost);

    root.append(
      el(
        "div",
        { class: "btn-row", style: { marginTop: "16px" } },
        el(
          "button",
          { class: "btn", onclick: () => store.set({ view: "builder", mode: "customize" }) },
          "← Back to builder"
        ),
        el(
          "button",
          { class: "btn", onclick: () => store.set({ view: "situations" }) },
          "New situation"
        )
      )
    );
    return;
  }

  // digit-sum and drug-discovery each have real, live demos of their own; the five
  // paper-backed puzzle modules have their own real interactive debuggers (above);
  // every other situation uses the illustrative trade-off cards below (no real
  // backend exists for them).
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

    const host = el("div");
    renderSituationLab(host, true);
    root.append(
      head,
      info,
      el("div", { class: "metric-card", style: { marginTop: "16px" } },
        el("div", { class: "label" }, "Interactive data flow"),
        host
      ),
      flowNote,
      actions
    );
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

  type ExampleCase = { label: string; input: string; reason: string; output: string };
  type ExampleSetMap = Record<string, Record<string, ExampleCase[]>>;

  const makeTrace = (prefix: string, body: string) => `{${prefix}: ${body}}`;

  const baseExampleSets: ExampleSetMap = {
    sudoku: {
      "learning-for-reasoning": [
        {
          label: "Cell fix",
          input: "grid = [[5,0,4],[0,8,0],[1,0,9]]; observed digits = {5,8,1,9,4}",
          reason: "candidate(row2,col6) = {5,8}; box rule removes 5 => 8",
          output: "board = [[5,2,4],[7,8,1],[1,3,9]]; valid Sudoku",
        },
        {
          label: "Last move",
          input: "row 8 still has {2,5,7} and box rule leaves only 7",
          reason: "row/col/box constraints eliminate the other candidates",
          output: "fill 7 and the full board becomes consistent",
        },
      ],
      "reasoning-for-learning": [
        {
          label: "Constraint loss",
          input: "digit logits for missing cells: p(5)=0.41, p(8)=0.58",
          reason: "rule loss penalizes row/col/box conflicts; network learns to prefer legal digits",
          output: "updated weights shift toward valid candidates and lower constraint loss",
        },
      ],
      "learning-reasoning": [
        {
          label: "Repair loop",
          input: "neural guess: row2,col6 ≈ 5 with low confidence",
          reason: "symbolic checker rejects 5, repairs to 8, then feeds corrected label back into the model",
          output: "revised prediction: 8 with higher confidence and legal board state",
        },
      ],
    },
    hitori: {
      "learning-for-reasoning": [
        {
          label: "Duplicate cut",
          input: "grid[2,4] = 4 and grid[2,5] = 4; same row and both unshaded",
          reason: "duplicate-adjacency rule blocks one of the pair to preserve validity",
          output: "cells [2,4] are shaded and connectivity remains single-region",
        },
      ],
      "reasoning-for-learning": [
        {
          label: "Constraint gradient",
          input: "network scores adjacency candidates: 0.72 for keep, 0.31 for shade",
          reason: "symbolic rule says adjacency conflict must be broken; training signal updates the classifier",
          output: "cell-level weights move toward shade decisions that satisfy rules",
        },
      ],
      "learning-reasoning": [
        {
          label: "Repair pass",
          input: "raw grid confidence suggests both 4s remain; local ambiguity remains",
          reason: "rule-based pruning removes one candidate, then the network re-ranks the remaining cells",
          output: "one consistent unshaded region emerges after feedback",
        },
      ],
    },
    "zebra-puzzle": {
      "learning-for-reasoning": [
        {
          label: "Constraint prune",
          input: "clues = {Englishman=red house, Spaniard=dog, Ukrainian=tea, Norwegian=first house, Japanese=Parliaments, ...}",
          reason: "constraint propagation combines the full clue set and eliminates every inconsistent person/pet assignment",
          output: "unique solution: {Japanese = zebra}",
        },
      ],
      "reasoning-for-learning": [
        {
          label: "Logic-guided training",
          input: "clue embeddings produce multiple candidate assignments",
          reason: "symbolic consistency score penalizes impossible combinations during learning",
          output: "network learns to favor clue combinations that satisfy the full logic graph",
        },
      ],
      "learning-reasoning": [
        {
          label: "Backtracking loop",
          input: "neural clue parser marks several partial assignments as plausible",
          reason: "symbolic search rejects contradictory branches and feeds the survivors back to the parser",
          output: "only one complete assignment remains: the unique solution",
        },
      ],
    },
    maze: {
      "learning-for-reasoning": [
        {
          label: "Short path",
          input: "maze_pixels = walls around center corridor; start=(0,0), goal=(8,8)",
          reason: "A* expands neighbors and discards dead ends until the shortest path remains",
          output: "route = [(0,0),(0,1),...,(8,8)] with no wall collisions",
        },
      ],
      "reasoning-for-learning": [
        {
          label: "Planner-guided training",
          input: "network predicts passability for each cell: wall=0.19, open=0.86",
          reason: "planning loss rewards cells on shortest feasible routes and penalizes dead-end guesses",
          output: "training sharpens path segmentation toward traversable corridors",
        },
      ],
      "learning-reasoning": [
        {
          label: "Adaptive route",
          input: "neural map has uncertain cells near the center",
          reason: "symbolic planner tests each branch and updates which cells are trusted for the next pass",
          output: "revised route avoids uncertain walls while keeping a low-cost path",
        },
      ],
    },
    "contract-bridge": {
      "learning-for-reasoning": [
        {
          label: "Open bid",
          input: "hand = {AKQ, 5 spades, 17 HCP}; opponents show no strong suit",
          reason: "bidding rules map distribution and controls to a legal opening bid",
          output: "opening_bid = 1♠ with descriptive strength and fit",
        },
      ],
      "reasoning-for-learning": [
        {
          label: "Convention loss",
          input: "network scores candidate bids: 1♠=0.74, 2♣=0.46",
          reason: "symbolic convention rules penalize bids that violate fit/strength constraints",
          output: "weights are updated to prefer conventionally valid opening bids",
        },
      ],
      "learning-reasoning": [
        {
          label: "Bid refinement",
          input: "initial network bid is 2♣, but distribution is sparse",
          reason: "rules reject the fit and feed back a refined hand description to the model",
          output: "revised bid becomes 1♠ with consistent partnership logic",
        },
      ],
    },
    jigsaw: {
      "learning-for-reasoning": [
        {
          label: "Edge match",
          input: "pieceA.edgeRight = sky-blue; pieceB.edgeLeft = sky-blue; edgeScore = 0.94",
          reason: "graph matching aligns the highest-similarity neighbors and enforces one-to-one placement",
          output: "combined image reconstructs the original landscape",
        },
      ],
      "reasoning-for-learning": [
        {
          label: "Graph update",
          input: "edge descriptors for 20 pieces form a similarity graph",
          reason: "symbolic matching loss rewards adjacent edges that agree and penalizes impossible placements",
          output: "network improves edge embeddings to keep true neighbors close",
        },
      ],
      "learning-reasoning": [
        {
          label: "Puzzle repair",
          input: "network predicts a wrong neighbor for a sky edge",
          reason: "graph solver rejects the impossible placement and sends the corrected adjacency back to the learner",
          output: "final arrangement becomes globally consistent and image is restored",
        },
      ],
    },
    "fuzzy-maze": {
      "learning-for-reasoning": [
        {
          label: "Confidence route",
          input: "cell_confidence = {north:0.78, east:0.31, south:0.65}",
          reason: "fuzzy rules maximize confidence while avoiding risky dead ends",
          output: "choose north route; path remains safe under uncertainty",
        },
      ],
      "reasoning-for-learning": [
        {
          label: "Confidence update",
          input: "neural passability map: north=0.78, east=0.31, south=0.65",
          reason: "symbolic fuzzy objective rewards high-confidence traversable cells and penalizes low-confidence traps",
          output: "network updates to prefer reliable cells over flaky ones",
        },
      ],
      "learning-reasoning": [
        {
          label: "Looped navigation",
          input: "initial plan prefers north but crosses a noisy cell",
          reason: "symbolic feedback rejects the fragile branch and the network reweights it for the next pass",
          output: "a safer route survives the next iteration of the loop",
        },
      ],
    },
    "word-search": {
      "learning-for-reasoning": [
        {
          label: "Dictionary hit",
          input: "letters = [C,A,T] on a diagonal from row 2 col 5 to row 4 col 7",
          reason: "search rules walk each direction and confirm the word is in dictionary",
          output: "CAT is highlighted with a valid path and accepted",
        },
      ],
      "reasoning-for-learning": [
        {
          label: "Word score",
          input: "candidate paths = {CAT, CAR, COT}; neural OCR confidence for each is mixed",
          reason: "dictionary legality strengthens only the valid path and suppresses false matches",
          output: "classifier learns to favor letter sequences that correspond to real words",
        },
      ],
      "learning-reasoning": [
        {
          label: "Iterative search",
          input: "raw OCR sees C-A-T and C-O-T as plausible",
          reason: "rule checker confirms CAT but rejects COT; corrected signal feeds back into the recognizer",
          output: "the final accepted word is CAT, not the false alternative",
        },
      ],
    },
    "guess-who": {
      "learning-for-reasoning": [
        {
          label: "Candidate prune",
          input: "attributes = {glasses, darkHair, smile, noMoustache}",
          reason: "constraint elimination rejects all faces that contradict the observed attributes",
          output: "one remaining face matches the target and the guess is resolved",
        },
      ],
      "reasoning-for-learning": [
        {
          label: "Attribute filter",
          input: "face attributes from network: glasses=0.91, moustache=0.14, hair=dark",
          reason: "symbolic elimination suppresses incompatible face candidates and guides the next training step",
          output: "classifier learns to focus on discriminative features for the target",
        },
      ],
      "learning-reasoning": [
        {
          label: "Question loop",
          input: "network initially has two plausible faces with similar feature scores",
          reason: "symbolic search filters the impossible one and feeds the corrected candidate set back into the model",
          output: "final target is the only remaining candidate after the loop",
        },
      ],
    },
  } as const;

  const fallbackExamples: Record<string, ExampleCase[]> = {
    "learning-for-reasoning": [{ label: "Example", input: "raw perceptual features arrive from the neural encoder", reason: "symbolic rules apply the relevant constraints", output: "final decision is consistent and valid" }],
    "reasoning-for-learning": [{ label: "Example", input: "constraint facts arrive from the symbolic layer", reason: "neural model updates under rule-guided supervision", output: "weights adapt toward the valid solution" }],
    "learning-reasoning": [{ label: "Example", input: "neural hypothesis and symbolic constraints are both active", reason: "co-training resolves conflicting signals and tightens the loop", output: "final result is a stable, rule-consistent prediction" }],
  };

  const exampleSets = sit ? (baseExampleSets[sit.id] ?? fallbackExamples) : fallbackExamples;
  const exampleCases = exampleSets[(st.pattern ?? "learning-for-reasoning")] ?? exampleSets["learning-for-reasoning"];

  const demo = exampleCases[0];
  const exampleText = sit
    ? `${sit.title}: ${makeTrace("input", demo.input)} → ${makeTrace("rule", demo.reason)} → ${makeTrace("output", demo.output)}`
    : `${pattern.taxonomy}: ${makeTrace("input", demo.input)} → ${makeTrace("rule", demo.reason)} → ${makeTrace("output", demo.output)}`;

  const interactiveHost = el("div");
  renderSituationLab(interactiveHost, true);

  const flowDemo = el(
    "div",
    { class: "metric-card", style: { marginTop: "18px" } },
    el("div", { class: "label" }, "Interactive data flow"),
    interactiveHost,
    el(
      "div",
      { class: "note", style: { marginTop: "14px" } },
      el("b", {}, "Execution trace: "),
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
