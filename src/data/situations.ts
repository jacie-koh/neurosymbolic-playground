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
  /** Emoji used on the situation card. */
  icon: string;
  /** Longer description shown when the card is focused. */
  description: string;

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

export const SITUATIONS: Situation[] = [
  // ---- Rule-/Logic-Guided (Neural → Symbolic) ----
  {
    id: "sudoku",
    title: "Sudoku Solver",
    tagline: "Read each cell digit from a grid image, then satisfy all constraints.",
    icon: "🔢",
    description:
      "A Sudoku board is shown as an image (digits rendered as MNIST samples). " +
      "A CNN reads each cell; a constraint-satisfaction engine (SAT/CSP solver) " +
      "applies the 27 Sudoku rules (row/column/box uniqueness) to find the solution. " +
      "Training uses SATNet's dataset: real puzzles with guaranteed unique solutions.",
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
    icon: "◻️",
    description:
      "A Hitori puzzle shows a grid of numbers, given directly — there is no image or " +
      "CNN here. The solver must shade some cells such that no two adjacent cells in the " +
      "same row/column are both unshaded AND have the same value, and all unshaded cells " +
      "form a single connected region. An exact solver proves each forced move by " +
      "contradiction, then a local LLM explains that already-proven move in plain language.",
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
    icon: "🧮",
    description:
      "A KenKen board shows a grid partitioned into cages, each labeled with a target number and an operator. " +
      "Computer vision finds the cage boundaries; a CNN reads each cage's target digits and operator; a " +
      "constraint solver enforces row/column uniqueness plus every cage's arithmetic.",
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
    icon: "🧩",
    description:
      "Given a few example images sharing a hidden property and several candidate images, a vision model " +
      "detects each scene's objects and attributes (shape, color, size, material) and their relations; a " +
      "symbolic learner searches for a first-order logic rule true on every example and exactly one candidate.",
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
    icon: "🦓",
    description:
      "A logic puzzle: 5 people, 5 house colors, 5 pets, 5 drinks, 5 nationalities. " +
      "Given clues like 'The Englishman lives in a red house' and 'The horse is next to...', " +
      "a CNN reads the clues; a first-order-logic solver deduces the solution. " +
      "Uses ZebraLogic benchmark (1K puzzles, variable difficulty).",
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
    suggestedMethod: "kg",
    suggestedPattern: "learning-for-reasoning",
    dataset: "circle",
    complexity: 3,
  },
];

export function getSituation(id: string | null): Situation | undefined {
  return SITUATIONS.find((s) => s.id === id);
}
