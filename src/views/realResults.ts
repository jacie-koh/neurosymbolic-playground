/**
 * "Results & trade-offs" for the five paper-backed modules: an architecture
 * diagram for each of Pure Neural / Neurosymbolic / Symbolic only, switchable
 * across the three stacking patterns — every stage and every number on it real.
 *
 * This replaces an earlier Performance/Explainability/Robustness bar-chart
 * version. Bars made "Explainability" look like a measured quantity when it
 * never was (0% for a raw neural confidence, 100% wherever a symbolic solver
 * returned sat — true by construction, not an estimate), and didn't show what
 * the pipeline actually *does*. A diagram does: each box is a real stage of the
 * real pipeline (perception, reasoning, a correction loop when one exists), and
 * the real accuracy number lives on the box it actually measures, not floating
 * in a separate meter. Where no real number exists for a column, it says so
 * instead of drawing an empty diagram.
 *
 * A stacking-pattern tab is either real (has actual measured/checkable data,
 * genuinely built and run) or removed: no tab is ever shown for a pattern this
 * project can't actually demonstrate, whether that's because it's structurally
 * impossible for the module (e.g. Hitori has no perception stage ever) or
 * because a real attempt isn't demoable right now (e.g. training a network on
 * a handful of real correction examples would be pure overfitting, not a real
 * result). The tab is hidden everywhere it's offered, not just here — see
 * isPatternRemoved(), also used by the builder page's chooser.
 */

import { el } from "../dom";
import { PATTERNS, PATTERN_ORDER } from "../data/patterns";
import { store, type StackingPattern } from "../state";

interface FlowStage {
  label: string;
  kind: "neural" | "symbolic" | "output";
  text: string;
}

interface Pipeline {
  stages: FlowStage[];
  /** A real correction/retry loop this pipeline has -- described in words,
   * since a literal feedback arrow isn't part of the flow-node vocabulary this
   * reuses (the same one the app's now-removed builder page used). */
  loopNote?: string;
  /** Additional real detail (e.g. a handwritten-vs-printed robustness split)
   * shown under the diagram, when there's something more to say than what's
   * already on the Output box. */
  caption?: string;
}

interface PatternRow {
  pureNeural: Pipeline | null;
  neurosymbolic: Pipeline | null;
  symbolicOnly: Pipeline | null;
  /** No tab is shown for this pattern — either it's structurally impossible for this
   * module, or a real demo of it isn't achievable right now (see isPatternRemoved()). */
  removed?: true;
}

type ModuleResults = Record<StackingPattern, PatternRow>;

const RESULTS: Partial<Record<string, ModuleResults>> = {
  sudoku: {
    "learning-for-reasoning": {
      pureNeural: {
        stages: [
          { label: "Perception", kind: "neural", text: "CNN reads each printed/handwritten digit" },
          { label: "Output", kind: "output", text: "90.9% exact — no solver, no checkable proof (800/800 real cases)" },
        ],
      },
      neurosymbolic: {
        stages: [
          { label: "Perception", kind: "neural", text: "CNN reads each digit, once" },
          { label: "Reasoning", kind: "symbolic", text: "Z3 solves once from the raw reading" },
          { label: "Output", kind: "output", text: "91.1% baseline_correct — a sat result is a checkable Z3 model" },
        ],
        caption: "Robustness (handwritten only): 82.2%, vs. 100% on printed.",
      },
      symbolicOnly: {
        stages: [
          { label: "Reasoning", kind: "symbolic", text: "Z3 solves from the ground-truth digits (no perception)" },
          { label: "Output", kind: "output", text: "100% (727/727) — solver reliability isolated from perception error" },
        ],
      },
    },
    "reasoning-for-learning": {
      pureNeural: null,
      neurosymbolic: null,
      symbolicOnly: null,
      removed: true, // Would need real gradient updates on ~10 real correction examples — not a demo, just overfitting.
    },
    "learning-reasoning": {
      pureNeural: {
        stages: [
          { label: "Perception", kind: "neural", text: "CNN reads each digit" },
          { label: "Output", kind: "output", text: "90.9% exact — perception doesn't change based on what happens after it" },
        ],
      },
      neurosymbolic: {
        stages: [
          { label: "Perception", kind: "neural", text: "CNN reads each digit, ranks alternatives" },
          { label: "Reasoning", kind: "symbolic", text: "Z3 solves; on conflict, retries a ranked alternative" },
          { label: "Output", kind: "output", text: "95.5% answer_correct — bounded correction loop" },
        ],
        loopNote: "↺ When Z3 hits a conflict, it retries the next-ranked CNN alternative for the disputed cell until sat or the retry budget runs out.",
        caption: "Robustness (handwritten only): 82.2% → 91.0% — this is exactly where the loop earns its keep.",
      },
      symbolicOnly: {
        stages: [
          { label: "Reasoning", kind: "symbolic", text: "Z3 solves from the ground-truth digits" },
          { label: "Output", kind: "output", text: "100% — the loop doesn't change what Z3 can prove given correct input" },
        ],
      },
    },
  },
  kenken: {
    "learning-for-reasoning": {
      pureNeural: null,
      neurosymbolic: {
        stages: [
          { label: "Perception", kind: "neural", text: "CV cage detection + CNN reads once" },
          { label: "Reasoning", kind: "symbolic", text: "Exact arithmetic solver runs once, no correction" },
          { label: "Output", kind: "output", text: "66.9% baseline_correct (1,400/1,400 real cases)" },
        ],
        caption: "Robustness (handwritten only): 34.6%, vs. 99.3% on printed — the real source of KenKen's size-degradation trend.",
      },
      symbolicOnly: {
        stages: [
          { label: "Reasoning", kind: "symbolic", text: "Solver runs from ground-truth cages (no perception)" },
          { label: "Output", kind: "output", text: "99.9% (943/944) — solver reliability isolated from perception error" },
        ],
      },
    },
    "reasoning-for-learning": {
      pureNeural: null,
      neurosymbolic: null,
      symbolicOnly: null,
      removed: true, // Same reason as Sudoku — real training on a handful of real correction examples wouldn't be a demo, just overfitting.
    },
    "learning-reasoning": {
      pureNeural: null,
      neurosymbolic: {
        stages: [
          { label: "Perception", kind: "neural", text: "CV cage detection + CNN reads, ranks alternatives" },
          { label: "Reasoning", kind: "symbolic", text: "Solver runs; on conflict, retries alternatives prioritized by unsat cores" },
          { label: "Output", kind: "output", text: "83.9% answer_correct — bounded joint-cage correction loop" },
        ],
        loopNote: "↺ On an unsat conflict, the loop retries ranked CNN alternatives for the cages the unsat core actually implicates, not every cage.",
        caption: "Robustness (handwritten only): 34.6% → 68.4% — real ground recovered, though a real ceiling remains.",
      },
      symbolicOnly: {
        stages: [
          { label: "Reasoning", kind: "symbolic", text: "Solver runs from ground-truth cages" },
          { label: "Output", kind: "output", text: "99.9% — same solver-reliability fact as the one-shot tab" },
        ],
      },
    },
  },
  hitori: {
    "learning-for-reasoning": {
      pureNeural: null,
      neurosymbolic: null,
      symbolicOnly: null,
      removed: true, // Hitori's grid is given directly, never read from an image — there is no perception stage to ever feed a solver, not just an unbuilt one.
    },
    "reasoning-for-learning": {
      pureNeural: null,
      neurosymbolic: {
        stages: [
          { label: "Reasoning", kind: "symbolic", text: "Tests the opposite of each cell's solved value; unsat proves the move forced" },
          { label: "Explain", kind: "neural", text: "Local LLM turns the first forced move's unsat core into prose" },
          { label: "Output", kind: "output", text: "100% (15/15) — proof verified first; the LLM's prose is labeled \"not formally verified\"" },
        ],
      },
      symbolicOnly: {
        stages: [
          { label: "Reasoning", kind: "symbolic", text: "Same forced-move proof search, no LLM step" },
          { label: "Output", kind: "output", text: "100% (15/15) — identical result; the explanation step never changes correctness" },
        ],
      },
    },
    "learning-reasoning": {
      pureNeural: null,
      neurosymbolic: null,
      symbolicOnly: null,
      removed: true, // Same reason — no perception stage exists to ever loop back into.
    },
  },
  "zebra-puzzle": {
    "learning-for-reasoning": {
      pureNeural: null,
      neurosymbolic: {
        stages: [
          { label: "Parse", kind: "neural", text: "Local Qwen3-4B translates numbered clues into typed relations" },
          { label: "Reasoning", kind: "symbolic", text: "Colored Exact Cover / MINIEXACT solves" },
          { label: "Output", kind: "output", text: "100% (6/6 original ZebraLogic puzzles) — independently checked against the real answer" },
        ],
        caption: "Only 6 puzzles sampled from the 1,000 downloaded — too small to also split out a separate robustness slice without overstating it.",
      },
      symbolicOnly: {
        stages: [
          { label: "Reasoning", kind: "symbolic", text: "MINIEXACT solves from correctly parsed clues" },
          { label: "Output", kind: "output", text: "100% — a complete Exact Cover solver's structural guarantee, not a sampled statistic" },
        ],
      },
    },
    "reasoning-for-learning": {
      pureNeural: null,
      neurosymbolic: null,
      symbolicOnly: null,
      removed: true, // Fine-tuning a 4B-parameter LLM isn't feasible on this machine, and there's no real training data for it beyond a handful of parse failures.
    },
    "learning-reasoning": {
      pureNeural: null,
      neurosymbolic: {
        stages: [
          { label: "Parse", kind: "neural", text: "Local LLM parses clues" },
          { label: "Reasoning", kind: "symbolic", text: "MINIEXACT solves; on unsat, re-prompts the LLM with the solver's own conflict" },
          { label: "Output", kind: "output", text: "1/1 real test — stayed unsat on both attempts, an honest negative result" },
        ],
        loopNote: "↺ run_with_conflict_retry() genuinely re-prompts the LLM with the real solver's unsat result and re-solves from scratch — mechanically real, not simulated.",
        caption: "Tested on one known-hard puzzle (real id lgp-test-6x6-5): a real solver conflict fed back to the LLM doesn't guarantee a better re-parse. That's a genuine finding, not a bug in the loop.",
      },
      symbolicOnly: {
        stages: [
          { label: "Reasoning", kind: "symbolic", text: "MINIEXACT solves" },
          { label: "Output", kind: "output", text: "100% — the solver's own completeness guarantee doesn't change with retries" },
        ],
      },
    },
  },
  "visual-discrimination": {
    "learning-for-reasoning": {
      pureNeural: {
        stages: [
          { label: "Similarity", kind: "neural", text: "Paper's own triplet-loss + prototypical-network baselines" },
          { label: "Output", kind: "output", text: "~36.5% average (~33% and ~40% reported) — barely above chance, no checkable proof" },
        ],
      },
      neurosymbolic: {
        stages: [
          { label: "Perception", kind: "neural", text: "From-scratch Faster R-CNN + MobileNetV3-Small attribute classifier" },
          { label: "Reasoning", kind: "symbolic", text: "Authors' unmodified FO-SL/Z3 synthesizer searches for a discriminator" },
          { label: "Output", kind: "output", text: "83% (5/6 held-out puzzles) — a sat result is a checkable FO-SL formula" },
        ],
        caption: "Robustness check: the same real synthesizer against the paper's own saved/replayed perception across a wider 15-puzzle sample — 12/15 sat.",
      },
      symbolicOnly: {
        stages: [{ label: "Reasoning", kind: "symbolic", text: "FO-SL/Z3 synthesizer alone" }],
        caption: "Not measured standalone here — this module has no ground-truth scene models to feed it directly; it's always paired with perception.",
      },
    },
    "reasoning-for-learning": {
      pureNeural: null,
      neurosymbolic: null,
      symbolicOnly: null,
      removed: true, // Same reason — real training data for this would need synthesis failures we don't actually have (the classifier is already 100% on every held-out object tested).
    },
    "learning-reasoning": {
      pureNeural: null,
      neurosymbolic: null,
      symbolicOnly: null,
      removed: true, // Checked feasibility (§ earlier): buildable in principle, but every held-out object already gets 100% attribute accuracy, so there's no real low-confidence failure to demonstrate a retry against.
    },
  },
};

function flowDiagram(p: Pipeline): HTMLElement {
  const nodes = p.stages.flatMap((stage, i) => [
    i > 0 ? el("div", { class: "flow-arrow" }, "→") : null,
    el(
      "div",
      { class: `flow-node ${stage.kind}`, style: { flex: "1 1 150px" } },
      el("div", { style: { fontSize: "10px", opacity: 0.8, marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.08em" } }, stage.label),
      stage.text
    ),
  ]);
  return el(
    "div",
    {},
    el("div", { class: "flow-demo", style: { display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" } }, ...nodes),
    p.loopNote ? el("div", { style: { fontSize: "12px", marginTop: "10px", color: "var(--muted)" } }, p.loopNote) : "",
    p.caption ? el("div", { style: { fontSize: "12px", marginTop: "8px", color: "var(--muted)" } }, p.caption) : ""
  );
}

function scoreCard(title: string, subtitle: string, pipeline: Pipeline | null): HTMLElement {
  return el(
    "div",
    { class: "metric-card" },
    el("div", { class: "label" }, title),
    el("div", { style: { fontSize: "13px", color: "var(--muted)", margin: "2px 0 14px" } }, subtitle),
    pipeline ? flowDiagram(pipeline) : el("div", { style: { fontSize: "12px", color: "var(--muted)" } }, "Not measured for this module's real pipeline.")
  );
}

export function renderRealResults(root: HTMLElement, situationId: string, onPatternChange: () => void): void {
  const data = RESULTS[situationId];
  if (!data) return;

  const availablePatterns = PATTERN_ORDER.filter((p) => !data[p].removed);

  // Hitori's real content lives under Symbolic → Neural (the solver proves a
  // deduction, then a local LLM explains it) — default there instead of the
  // usual Neural → Symbolic tab, which is removed entirely for this module.
  const defaultPattern: StackingPattern = situationId === "hitori" ? "reasoning-for-learning" : "learning-for-reasoning";
  let pattern: StackingPattern = store.get().pattern ?? defaultPattern;
  if (data[pattern].removed) pattern = availablePatterns[0];
  const body = el("div", { style: { marginTop: "16px" } });

  function draw(): void {
    body.replaceChildren();
    const row = data![pattern];

    const switcher = el(
      "div",
      { class: "seg" },
      ...availablePatterns.map((p) =>
        el(
          "button",
          {
            class: "seg-btn" + (p === pattern ? " active" : ""),
            onclick: () => { store.set({ pattern: p }); onPatternChange(); },
          },
          el("span", { class: "seg-flow" }, PATTERNS[p].flow),
          el("span", { class: "seg-name" }, PATTERNS[p].taxonomy)
        )
      )
    );

    const grid = el(
      "div",
      { class: "results-grid", style: { marginTop: "14px" } },
      scoreCard("Pure neural", "Baseline — perception only, no solver", row.pureNeural),
      scoreCard("Neurosymbolic", `${PATTERNS[pattern].flow} — real pipeline result`, row.neurosymbolic),
      scoreCard("Symbolic only", "Reasoning only, no perception", row.symbolicOnly)
    );

    body.append(switcher, grid);
  }

  draw();

  root.append(
    el(
      "div",
      { class: "metric-card" },
      el("div", { class: "label" }, "Results & trade-offs — real architecture, real numbers"),
      body
    )
  );
}

/** True when this pattern is structurally impossible for this situation (e.g. Hitori has no
 * perception stage, ever) — used to hide the option everywhere it's offered, not just here. */
export function isPatternRemoved(situationId: string | null, pattern: StackingPattern): boolean {
  const data = situationId ? RESULTS[situationId] : undefined;
  return !!data?.[pattern]?.removed;
}
