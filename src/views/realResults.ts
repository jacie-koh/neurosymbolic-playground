/**
 * "Results & trade-offs" for the five paper-backed modules: the original
 * TF-Playground-style panel shape (Pure Neural / Neurosymbolic / Symbolic only,
 * each with Performance / Explainability / Robustness bars, switchable across
 * the three stacking patterns) — but every number is real.
 *
 * Performance and Robustness are freshly aggregated from the real full
 * 2,200-case sweep (standalone/reports/visual_full.json) for Sudoku/KenKen, or
 * from standalone/VALIDATION.md for the rest. Explainability isn't a survey
 * score: it's 0% for a raw neural confidence (no checkable proof exists) and
 * 100% wherever a symbolic solver actually ran and returned sat — a Z3 model,
 * forced-move proof, or MINIEXACT/FO-SL solution is a checkable witness by
 * construction, not an estimate. Where no real number exists for a cell, it
 * says so instead of inventing one.
 *
 * A stacking-pattern tab is one of three things per module: real (has actual
 * measured/checkable data), hypothetical (not built, but a coherent thing that
 * COULD be — shown as a clearly-labeled description, never fake numbers), or
 * removed (structurally impossible for this module, e.g. Hitori has no
 * perception stage ever — the tab is hidden everywhere it's offered, not just
 * here; see isPatternRemoved(), also used by the builder page's chooser).
 */

import { el } from "../dom";
import { PATTERNS, PATTERN_ORDER } from "../data/patterns";
import { store, type StackingPattern } from "../state";

interface Bar {
  value: number | null; // 0..1, or null = not measured / not applicable
  detail: string;
}

interface ColumnStats {
  performance: Bar;
  explainability: Bar;
  robustness: Bar;
}

interface PatternRow {
  pureNeural: ColumnStats;
  neurosymbolic: ColumnStats;
  symbolicOnly: ColumnStats;
  /** This pattern has no real implementation for this module, but is a coherent thing that
   * COULD be built — shown as a clearly-labeled hypothetical instead of real measurements. */
  hypothetical?: string;
  /** This pattern is structurally impossible for this module (not just unbuilt) — omit its
   * tab from the switcher entirely rather than showing anything for it. */
  removed?: true;
}

type ModuleResults = Record<StackingPattern, PatternRow>;

const NA: Bar = { value: null, detail: "" };
const NOT_TRAINED = { value: 0 as number | null, detail: "A raw network confidence isn't a checkable proof — 0% by construction, not a measurement." };
const PROVEN = { value: 1 as number | null, detail: "A sat result always comes with a checkable witness (a Z3 model, forced-move proof, or exact-cover/FO-SL solution) — true by construction of exact solving, not a measured estimate." };

const RESULTS: Partial<Record<string, ModuleResults>> = {
  sudoku: {
    "learning-for-reasoning": {
      pureNeural: {
        performance: { value: 0.909, detail: "perception_exact — every digit read correctly, no solving involved. 800/800 real cases." },
        explainability: NOT_TRAINED,
        robustness: { value: 0.818, detail: "Same perception check restricted to the 400 handwritten cases only (vs. 100% on printed)." },
      },
      neurosymbolic: {
        performance: { value: 0.911, detail: "baseline_correct — CNN reads once, Z3 solves once, no correction loop." },
        explainability: PROVEN,
        robustness: { value: 0.822, detail: "Same one-shot pipeline restricted to the 400 handwritten cases only (vs. 100% on printed)." },
      },
      symbolicOnly: {
        performance: { value: 1.0, detail: "727/727 — when perception was exactly correct, Z3 found the correct answer every time (solver reliability, isolated from perception error)." },
        explainability: PROVEN,
        robustness: NA,
      },
    },
    "reasoning-for-learning": {
      pureNeural: { performance: NA, explainability: NA, robustness: NA },
      neurosymbolic: { performance: NA, explainability: NA, robustness: NA },
      symbolicOnly: { performance: NA, explainability: NA, robustness: NA },
      hypothetical: "Not built, but coherent: Z3's row/column/box conflicts could be replayed as a training signal — fine-tuning the digit-recognition CNN specifically on cases where a misread also broke a constraint (e.g. confusing an 8 for a 3). That could reduce exactly the systematic misreads seen in the handwritten strata. This project keeps perception frozen and only ever independently checks it, since training against this benchmark's own correction outputs risks quietly overfitting to it rather than genuinely improving perception.",
    },
    "learning-reasoning": {
      pureNeural: {
        performance: { value: 0.909, detail: "Perception doesn't change based on what happens after it — same number as the one-shot tab." },
        explainability: NOT_TRAINED,
        robustness: { value: 0.818, detail: "Same as the one-shot tab." },
      },
      neurosymbolic: {
        performance: { value: 0.955, detail: "answer_correct with the bounded correction loop: when Z3 finds a conflict, it retries ranked CNN alternatives until sat or budget exhausted." },
        explainability: PROVEN,
        robustness: { value: 0.91, detail: "Same correction loop restricted to the 400 handwritten cases only — this is where the loop earns its keep (82.2% → 91.0%)." },
      },
      symbolicOnly: {
        performance: { value: 1.0, detail: "Same solver-reliability fact as the one-shot tab — the loop doesn't change what Z3 can prove given correct input." },
        explainability: PROVEN,
        robustness: NA,
      },
    },
  },
  kenken: {
    "learning-for-reasoning": {
      pureNeural: {
        performance: NA,
        explainability: NOT_TRAINED,
        robustness: NA,
      },
      neurosymbolic: {
        performance: { value: 0.669, detail: "baseline_correct — CV cage detection + CNN reads once, exact arithmetic solver runs once, no correction. 1,400/1,400 real cases." },
        explainability: PROVEN,
        robustness: { value: 0.346, detail: "Same one-shot pipeline restricted to the 700 handwritten cases only (vs. 99.3% on printed) — this is the real source of KenKen's size-degradation trend." },
      },
      symbolicOnly: {
        performance: { value: 0.999, detail: "943/944 — when the cage read needed zero corrections, the answer was correct essentially every time (solver reliability, isolated from perception error)." },
        explainability: PROVEN,
        robustness: NA,
      },
    },
    "reasoning-for-learning": {
      pureNeural: { performance: NA, explainability: NA, robustness: NA },
      neurosymbolic: { performance: NA, explainability: NA, robustness: NA },
      symbolicOnly: { performance: NA, explainability: NA, robustness: NA },
      hypothetical: "Not built, but coherent: every correction the pipeline makes is already recorded (which cage, what the CNN read, what it should have been). That log could hypothetically become fine-tuning data for the cage-reading CNN, so the segmentation bug behind the 96%→25% size-degradation trend gets learned away instead of patched at inference time via search. This project kept the CNN frozen and only ever independently re-verified it, since training on this benchmark's own correction outputs risks overfitting to this specific dataset's error patterns rather than fixing recognition generally.",
    },
    "learning-reasoning": {
      pureNeural: { performance: NA, explainability: NOT_TRAINED, robustness: NA },
      neurosymbolic: {
        performance: { value: 0.839, detail: "answer_correct with the bounded joint-cage correction loop, prioritized by unsat cores. 1,400/1,400 real cases." },
        explainability: PROVEN,
        robustness: { value: 0.684, detail: "Same correction loop restricted to the 700 handwritten cases only — the loop recovers real ground here (34.6% → 68.4%), though a real ceiling remains (see notes)." },
      },
      symbolicOnly: {
        performance: { value: 0.999, detail: "Same solver-reliability fact as the one-shot tab." },
        explainability: PROVEN,
        robustness: NA,
      },
    },
  },
  hitori: {
    "learning-for-reasoning": {
      pureNeural: { performance: NA, explainability: NA, robustness: NA },
      neurosymbolic: { performance: NA, explainability: NA, robustness: NA },
      symbolicOnly: { performance: NA, explainability: NA, robustness: NA },
      removed: true, // Hitori's grid is given directly, never read from an image — there is no perception stage to ever feed a solver, not just an unbuilt one.
    },
    "reasoning-for-learning": {
      pureNeural: {
        performance: NA,
        explainability: NOT_TRAINED,
        robustness: NA,
      },
      neurosymbolic: {
        performance: { value: 1.0, detail: "15/15 sampled pencil-puzzle-bench puzzles (6×6, 8×8, 11×10) match that dataset's recorded solutions. The proof is verified first (symbolic); the local LLM then explains it in prose, labeled by the pipeline itself as \"not formally verified.\"" },
        explainability: PROVEN,
        robustness: NA,
      },
      symbolicOnly: {
        performance: { value: 1.0, detail: "Identical 15/15 — the LLM explanation step is a pure add-on for human readability and never changes whether the puzzle is solved correctly." },
        explainability: PROVEN,
        robustness: NA,
      },
    },
    "learning-reasoning": {
      pureNeural: { performance: NA, explainability: NA, robustness: NA },
      neurosymbolic: { performance: NA, explainability: NA, robustness: NA },
      symbolicOnly: { performance: NA, explainability: NA, robustness: NA },
      removed: true, // Same reason — no perception stage exists to ever loop back into.
    },
  },
  "zebra-puzzle": {
    "learning-for-reasoning": {
      pureNeural: {
        performance: NA,
        explainability: NOT_TRAINED,
        robustness: NA,
      },
      neurosymbolic: {
        performance: { value: 1.0, detail: "6/6 original ZebraLogic puzzles solved correctly: fresh local Qwen3-4B parse feeding the authors' Colored Exact Cover / MINIEXACT solver, independently checked against the real answer." },
        explainability: PROVEN,
        robustness: { value: null, detail: "Only 6 puzzles sampled from the 1,000 downloaded — too small to split into an independent robustness slice without overstating it." },
      },
      symbolicOnly: {
        performance: { value: 1.0, detail: "MINIEXACT is a complete Exact Cover solver: given correctly parsed clues, it always finds the unique valid assignment — a structural solver guarantee, not a separate sampled statistic." },
        explainability: PROVEN,
        robustness: NA,
      },
    },
    "reasoning-for-learning": {
      pureNeural: { performance: NA, explainability: NA, robustness: NA },
      neurosymbolic: { performance: NA, explainability: NA, robustness: NA },
      symbolicOnly: { performance: NA, explainability: NA, robustness: NA },
      hypothetical: "Not built, but coherent: MINIEXACT's solved (or failed) assignments could hypothetically become a fine-tuning signal for the LLM parser, nudging it toward clue interpretations that tend to be satisfiable. This project keeps the LLM frozen and only ever prompts it — a parse that turns out wrong is recorded as a real, honest failure (one of the batch-generated examples really does come back unsat) rather than trained away. Parsing does retry the LLM once on a JSON schema error, but that's a format check on the LLM's own output shape, not the solver reasoning about the puzzle — it doesn't count as this pattern.",
    },
    "learning-reasoning": {
      pureNeural: { performance: NA, explainability: NA, robustness: NA },
      neurosymbolic: { performance: NA, explainability: NA, robustness: NA },
      symbolicOnly: { performance: NA, explainability: NA, robustness: NA },
      hypothetical: "Not built, but coherent: a tight loop would mean a specific solver conflict (e.g. \"clue 4 and clue 9 can't both hold\") gets fed back to the LLM as a targeted re-prompt about just those two clues, instead of re-parsing from scratch. The real pipeline never does this — MINIEXACT runs exactly once per puzzle, with no path back to the parser.",
    },
  },
  "visual-discrimination": {
    "learning-for-reasoning": {
      pureNeural: {
        performance: { value: 0.365, detail: "The paper's own two pure-neural baselines average ~36.5% (~33% and ~40% reported) — real numbers from the published paper." },
        explainability: NOT_TRAINED,
        robustness: NA,
      },
      neurosymbolic: {
        performance: { value: 0.83, detail: "5/6 held-out puzzles: from-scratch Faster R-CNN + MobileNetV3-Small attribute classifier feeding the authors' real, unmodified FO-SL/Z3 synthesizer." },
        explainability: PROVEN,
        robustness: { value: 0.8, detail: "Same real synthesizer, run against the paper's own saved/replayed perception across a wider 15-puzzle sample: 12/15 sat — a stability check across a different perception source." },
      },
      symbolicOnly: {
        performance: NA,
        explainability: PROVEN,
        robustness: NA,
      },
    },
    "reasoning-for-learning": {
      pureNeural: { performance: NA, explainability: NA, robustness: NA },
      neurosymbolic: { performance: NA, explainability: NA, robustness: NA },
      symbolicOnly: { performance: NA, explainability: NA, robustness: NA },
      hypothetical: "Not built, but coherent: when the FO-SL synthesizer can't find a discriminator, that failure could hypothetically fine-tune the attribute classifier — e.g. sharpening the depth estimate used for front/behind, already identified as the real system's weakest link. This project fine-tunes the vision stack once, offline, on held-out training data only; synthesis-stage feedback never touches it.",
    },
    "learning-reasoning": {
      pureNeural: { performance: NA, explainability: NA, robustness: NA },
      neurosymbolic: { performance: NA, explainability: NA, robustness: NA },
      symbolicOnly: { performance: NA, explainability: NA, robustness: NA },
      hypothetical: "Not built, but coherent: a tight loop would mean a failed synthesis re-triggers perception — re-examining specifically the object pair whose depth estimate is most uncertain, rather than accepting the first perception pass as final. The real pipeline never does this: perception runs exactly once, and synthesis has no way to ask for another look.",
    },
  },
};

function bar(label: string, color: string, b: Bar): HTMLElement {
  if (b.value == null) {
    return el(
      "div",
      { style: { marginBottom: "10px" } },
      el("div", { style: { fontSize: "12px", marginBottom: "2px" } }, el("span", { class: "muted" }, label)),
      el("div", { style: { fontSize: "11px", color: "var(--muted)" } }, b.detail || "Not measured for this module's real pipeline.")
    );
  }
  const pct = Math.round(b.value * 100);
  return el(
    "div",
    { style: { marginBottom: "10px" } },
    el(
      "div",
      { style: { display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "4px" } },
      el("span", { class: "muted" }, label),
      el("b", {}, `${pct}%`)
    ),
    el("div", { class: "meter" }, el("span", { style: { width: `${pct}%`, background: color } })),
    b.detail ? el("div", { style: { fontSize: "11px", color: "var(--muted)", marginTop: "3px" } }, b.detail) : ""
  );
}

function scoreCard(title: string, subtitle: string, stats: ColumnStats): HTMLElement {
  return el(
    "div",
    { class: "metric-card" },
    el("div", { class: "label" }, title),
    el("div", { style: { fontSize: "13px", color: "var(--muted)", margin: "2px 0 14px" } }, subtitle),
    bar("Performance", "#0877bd", stats.performance),
    bar("Explainability", "#8e44ad", stats.explainability),
    bar("Robustness", "#f59322", stats.robustness)
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

    if (row.hypothetical) {
      body.append(
        switcher,
        el(
          "div",
          { class: "note", style: { marginTop: "14px", borderLeft: "3px solid var(--muted)" } },
          el("span", { class: "badge", style: { marginRight: "8px" } }, "hypothetical — not implemented"),
          el("br"),
          el("span", { style: { display: "inline-block", marginTop: "6px" } }, row.hypothetical)
        )
      );
      return;
    }

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
      el("div", { class: "label" }, "Results & trade-offs — real measurements, not illustrative estimates"),
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
