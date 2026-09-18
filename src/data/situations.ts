/**
 * The "situations" the user picks from in step 1: the five puzzle modules with
 * a real standalone/ research backend (pretrained CNNs, Z3/SAT solving) behind
 * an interactive debugger — Sudoku, Hitori, KenKen, Visual Discrimination, Zebra.
 */

import type { SymbolicMethod, StackingPattern } from "../state";

/** A TF-Playground-style 2D dataset the neural block can actually train on. */
export type DatasetKind = "circle" | "xor" | "gauss" | "spiral";

export interface Situation {
  id: string;
  title: string;
  tagline: string;
  /** Inline SVG markup used on the situation card (not an emoji -- rendering
   * consistency and a less "generated" look, not decoration). */
  icon: string;
  /** What the neural net is asked to perceive (plain language). */
  perception: string;
  /** What the symbolic engine is asked to reason about (plain language). */
  reasoning: string;

  /** Why a pure neural net struggles here. */
  neuralWeakness: string;
  /** Why a pure symbolic system struggles here. */
  symbolicWeakness: string;
  /** Why combining them wins. */
  combinedStrength: string;

  /** The symbolic method this situation is designed to showcase. */
  suggestedMethod: SymbolicMethod;
  /** The stacking pattern that fits this situation best. */
  suggestedPattern: StackingPattern;
  /** The 2D dataset the neural detail view trains on (keeps it TF-identical). */
  dataset: DatasetKind;
  /** Relative difficulty, 1 (simple) .. 3 (complex). */
  complexity: 1 | 2 | 3;
  /** If true, this situation is an exception: no clean perceive→reason split. */
  isException?: boolean;
}

const SVG_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">';

/** A plain 3x3 grid -- Sudoku's own board, no embellishment. */
const ICON_SUDOKU =
  SVG_OPEN +
  '<rect x="3" y="3" width="18" height="18" rx="1.5"/>' +
  '<line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>' +
  '<line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/>' +
  "</svg>";

/** The same grid, with three cells shaded solid -- Hitori's own move. */
const ICON_HITORI =
  SVG_OPEN +
  '<rect x="3" y="3" width="18" height="18" rx="1.5"/>' +
  '<line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>' +
  '<line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/>' +
  '<rect x="9.4" y="3.4" width="5.2" height="5.2" fill="currentColor" stroke="none"/>' +
  '<rect x="3.4" y="15.4" width="5.2" height="5.2" fill="currentColor" stroke="none"/>' +
  '<rect x="15.4" y="9.4" width="5.2" height="5.2" fill="currentColor" stroke="none"/>' +
  "</svg>";

/** A grid carved by two bold, irregular cage boundaries -- KenKen's cages, not
 * Sudoku's uniform 3x3 split. */
const ICON_KENKEN =
  SVG_OPEN +
  '<rect x="3" y="3" width="18" height="18" rx="1.5"/>' +
  '<path d="M9 3v8h12" stroke-width="2.3"/>' +
  '<path d="M3 15h9v6" stroke-width="2.3"/>' +
  "</svg>";

/** Three plain shapes in a row -- comparing scenes to find the odd one out. */
const ICON_VDP =
  SVG_OPEN +
  '<circle cx="5.5" cy="12" r="3"/>' +
  '<rect x="10" y="9" width="6" height="6" rx="1"/>' +
  '<path d="M20 9l3 6h-6z"/>' +
  "</svg>";

/** A striped bar -- the zebra motif, kept purely geometric. */
const ICON_ZEBRA =
  SVG_OPEN +
  '<rect x="3" y="6" width="18" height="12" rx="2"/>' +
  '<line x1="7" y1="6" x2="7" y2="18" stroke-width="2.2"/>' +
  '<line x1="11" y1="6" x2="11" y2="18" stroke-width="2.2"/>' +
  '<line x1="15" y1="6" x2="15" y2="18" stroke-width="2.2"/>' +
  '<line x1="19" y1="6" x2="19" y2="18" stroke-width="2.2"/>' +
  "</svg>";

export const SITUATIONS: Situation[] = [
  // ---- Rule-/Logic-Guided (Neural → Symbolic) ----
  {
    id: "sudoku",
    title: "Sudoku Solver",
    tagline: "Read each cell digit from a grid image, then satisfy all constraints.",
    icon: ICON_SUDOKU,
    perception: "Recognize each digit in a 9×9 grid from pixel-rendered images.",
    reasoning: "Apply Sudoku constraints: each row, column, and 3×3 box must contain digits 1–9 exactly once.",
    neuralWeakness:
      "A pure CNN memorizes which cells are filled and guesses the rest; " +
      "it fails on unseen puzzle patterns because it hasn't learned the actual rules.",
    symbolicWeakness:
      "A pure solver can't read pixel images — it needs the digit labels first. " +
      "Hand-label a few hundred puzzles and you've solved that puzzle but learned nothing for the next one.",
    combinedStrength:
      "The net learns digit perception from puzzle examples; the solver enforces " +
      "perfect constraint satisfaction. Together they solve puzzles end-to-end, " +
      "learning from weak supervision (just the initial givens, not all solutions).",
    suggestedMethod: "rules",
    suggestedPattern: "learning-for-reasoning",
    dataset: "circle",
    complexity: 3,
  },
  {
    id: "hitori",
    title: "Hitori Puzzle Solver",
    tagline: "Read a grid of numbers, mark cells to block duplicates and isolate groups.",
    icon: ICON_HITORI,
    perception: "N/A — the grid is given directly; there is no perception stage for this puzzle.",
    reasoning: "Prove each cell's value is forced by contradiction, then explain the proof in prose.",
    neuralWeakness:
      "N/A — no neural component perceives anything here; the only neural step explains an " +
      "already-verified symbolic proof, so a weak explanation never makes the puzzle wrong.",
    symbolicWeakness:
      "A bare proof is logically complete but not naturally readable — a person still has to " +
      "translate 'this cell's opposite value causes a contradiction' into plain language.",
    combinedStrength:
      "The solver proves every forced move is genuinely necessary; the local LLM then explains " +
      "that proof in prose — reasoning first, with language generation grounded in it, not the " +
      "usual perceive-then-reason order the other four modules use.",
    suggestedMethod: "forward-chaining",
    suggestedPattern: "reasoning-for-learning",
    dataset: "circle",
    complexity: 2,
  },
  {
    id: "kenken",
    title: "KenKen Solver",
    tagline: "Read digits, operators, and cage boundaries from a grid image, then satisfy row/column and cage arithmetic.",
    icon: ICON_KENKEN,
    perception: "Detect cage boundaries and read each cage's target number and operator from the image.",
    reasoning: "Apply row/column uniqueness plus each cage's arithmetic (sum, product, difference, or quotient).",
    neuralWeakness:
      "A pure CNN can misread multi-digit targets or touching handwritten glyphs, and has no way to check " +
      "whether a reading is even arithmetically possible for the cage's cell count and grid size.",
    symbolicWeakness:
      "A pure solver can't read pixels or find cage boundaries — it needs the cage structure and targets first.",
    combinedStrength:
      "Vision finds structure and reads labels; the solver enforces exact arithmetic and can flag or correct " +
      "readings that are mathematically impossible for the puzzle.",
    suggestedMethod: "rules",
    suggestedPattern: "learning-for-reasoning",
    dataset: "circle",
    complexity: 3,
  },
  {
    id: "visual-discrimination",
    title: "Visual Discrimination Puzzle",
    tagline: "Look at example and candidate scenes, then find the rule that picks out the right one.",
    icon: ICON_VDP,
    perception: "Detect objects and their attributes/relations (shape, color, size, material, left-of, etc.) in each scene.",
    reasoning: "Search a bounded first-order logic fragment for a discriminating rule, verified independently.",
    neuralWeakness:
      "A pure similarity or prototype network picks the 'closest-looking' candidate without any explicit, " +
      "checkable rule — it performs little better than chance on puzzles designed to need real discrimination.",
    symbolicWeakness:
      "A pure rule search can't see the images — it needs objects, attributes, and relations extracted first.",
    combinedStrength:
      "Perception extracts a structured scene description; symbolic search finds an interpretable rule and " +
      "proves it holds on every example and exactly one candidate — verifiable, not just plausible.",
    suggestedMethod: "kg",
    suggestedPattern: "learning-for-reasoning",
    dataset: "circle",
    complexity: 3,
  },
  {
    id: "zebra-puzzle",
    title: "Zebra Puzzle",
    tagline: "Read clues describing 5 people and their attributes; deduce who owns the zebra.",
    icon: ICON_ZEBRA,
    perception: "Parse written clues and encode them as logical predicates.",
    reasoning: "Apply constraint propagation and backtracking to find the unique consistent assignment.",
    neuralWeakness:
      "A pure network can memorize common clue patterns but fails on novel orderings, " +
      "distances, or attribute combinations not seen in training.",
    symbolicWeakness:
      "The logical rules are deterministic and sound, but humans must manually " +
      "write them for each puzzle variant; the solver can't read clues.",
    combinedStrength:
      "The network learns to parse clues; the solver enforces logical consistency. " +
      "Together they solve fresh puzzles from weak supervision (just the answer set).",
    suggestedMethod: "rules",
    suggestedPattern: "learning-for-reasoning",
    dataset: "circle",
    complexity: 3,
  },
];

export function getSituation(id: string | null): Situation | undefined {
  return SITUATIONS.find((s) => s.id === id);
}
