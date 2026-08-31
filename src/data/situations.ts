/**
 * The "situations" the user picks from in step 1.
 *
 * Game-based examples where neural perception meets symbolic reasoning:
 * logic puzzles (Sudoku, Hitori, Zebra), spatial reasoning (Maze, Jigsaw),
 * strategy games (Contract Bridge, Word Search), and deduction games (Guess Who?).
 * 
 * Mafia/Werewolf is included as an exception: pure reasoning-oriented LLM
 * with no clean perception→reason split.
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
      "A Hitori puzzle shows a grid of numbers. The solver must shade some cells " +
      "such that no two adjacent cells in the same row/column are both unshaded " +
      "AND have the same value, and all unshaded cells form a single connected region. " +
      "A CNN reads the grid; a symbolic solver checks the three Hitori rules.",
    perception: "Recognize each number in the grid from image pixels.",
    reasoning: "Mark cells so no duplicates are adjacent, and all unshaded cells are connected.",
    neuralWeakness:
      "A CNN can learn to mark cells heuristically but has no reason to enforce " +
      "connectivity or globally satisfy constraints — it overfits to puzzle patterns.",
    symbolicWeakness:
      "The symbolic rules are simple once you know the numbers, but a pure solver " +
      "can't read pixels; it needs human labeling or a separate OCR system.",
    combinedStrength:
      "Perception reads the grid; the symbolic solver keeps the solution globally " +
      "consistent. The network learns which cells matter from weak supervision.",
    suggestedMethod: "rules",
    suggestedPattern: "learning-for-reasoning",
    dataset: "circle",
    complexity: 2,
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
    suggestedMethod: "rules",
    suggestedPattern: "learning-for-reasoning",
    dataset: "circle",
    complexity: 3,
  },
  {
    id: "maze",
    title: "Maze Solver",
    tagline: "Read a maze image, find the path from start to goal.",
    icon: "🧭",
    description:
      "A maze is rendered as a pixel image (walls are dark, paths are light). " +
      "A CNN segments the image to find walls and paths; a graph-search algorithm " +
      "(BFS/A*) plans a route from start to goal. Training uses generated mazes " +
      "(DFS, Wilson's, or percolation methods) at varying complexity.",
    perception: "Identify walls, paths, start, and goal from the maze image.",
    reasoning: "Compute a collision-free path from start to goal using graph search.",
    neuralWeakness:
      "A pure CNN can learn to trace paths locally but has no global view; " +
      "it overfits to maze topologies seen in training and doesn't generalize.",
    symbolicWeakness:
      "A pure pathfinder needs a hand-crafted grid or perfect segmentation; " +
      "it can't handle real-world maze images with noise or varying wall widths.",
    combinedStrength:
      "Perception extracts a clean topology from the image; the symbolic planner " +
      "guarantees a globally optimal path. The network learns segmentation robustness.",
    suggestedMethod: "rules",
    suggestedPattern: "learning-for-reasoning",
    dataset: "circle",
    complexity: 2,
  },
  {
    id: "contract-bridge",
    title: "Contract Bridge Bidding",
    tagline: "Read your hand of cards, apply bidding rules to communicate strength and distribution.",
    icon: "🃏",
    description:
      "In Contract Bridge, players bid to communicate their hand strength and suit distribution. " +
      "An encoder (neural) processes your 13 cards and opponents' revealed information; " +
      "a bidding rule engine applies Standard American Yellow Card conventions to suggest a bid. " +
      "Training uses WBridge5's deal dataset (1M bids from a strong computer player).",
    perception: "Encode your hand's strength, distribution, and controls from the 13 cards dealt.",
    reasoning: "Apply bidding conventions to select the bid that best describes your hand.",
    neuralWeakness:
      "A pure network can learn hand-strength correlation but misses the structured " +
      "logic of bidding systems; it produces inconsistent (unreliable to partner) bids.",
    symbolicWeakness:
      "Bidding rules are precise and deterministic, but they require numerical features " +
      "(high-card points, suit lengths, controls) that must be computed from raw cards.",
    combinedStrength:
      "The network learns to encode hand features; the rule engine produces consistent, " +
      "human-interpretable bids. Partners can predict each other's hands reliably.",
    suggestedMethod: "rules",
    suggestedPattern: "learning-for-reasoning",
    dataset: "gauss",
    complexity: 3,
  },

  // ---- Graph-Based Reasoning (Neural → Symbolic) ----
  {
    id: "jigsaw",
    title: "Jigsaw Puzzle Reconstruction",
    tagline: "Read image fragments and match edges to reconstruct the original image.",
    icon: "🧩",
    description:
      "A jigsaw puzzle is broken into 9–376 pieces. A CNN extracts edge descriptors " +
      "from each fragment; a graph-matching solver finds the permutation that minimizes " +
      "edge dissimilarity and reconstructs the image. Uses LSU Fragmented Image Repository " +
      "and JigsawNet (450+ puzzles, 400 synthetic + 40 hand-torn + 10 real scanned).",
    perception: "Extract edge vectors and corner features from each jigsaw piece.",
    reasoning: "Match edges between pieces to find the correct permutation and spatial arrangement.",
    neuralWeakness:
      "A pure CNN classifies individual piece features but has no way to enforce " +
      "global consistency (each piece placed exactly once, all edges matched).",
    symbolicWeakness:
      "Graph matching can find the best permutation if given edge similarity scores, " +
      "but the network must extract those scores from raw pixel data first.",
    combinedStrength:
      "Perception learns robust edge descriptors despite image variation; the solver " +
      "enforces global coherence. Together they handle puzzle variants unseen in training.",
    suggestedMethod: "kg",
    suggestedPattern: "learning-for-reasoning",
    dataset: "circle",
    complexity: 3,
  },

  // ---- Hybrid Neural-Symbolic (Tightly Coupled) ----
  {
    id: "fuzzy-maze",
    title: "Fuzzy-Logic Maze Navigation",
    tagline: "Neural confidence feeds fuzzy rules; rules guide learning through uncertain walls.",
    icon: "🌊",
    description:
      "A maze with soft (fuzzy) walls — the CNN outputs confidence that each cell " +
      "is passable (not a hard threshold, but 0..1 probability). A fuzzy-logic planner " +
      "selects the best-confidence path in real time, and its success/failure signal " +
      "flows back to improve the network. Tight neural↔symbolic loop.",
    perception: "Estimate traversability confidence (0..1) for each maze cell.",
    reasoning: "Plan a path that maximizes overall confidence using fuzzy aggregation.",
    neuralWeakness:
      "A pure confidence estimator produces no path guarantee; it can pick high-confidence " +
      "dead ends if it's memorized, and it doesn't learn from plan failures.",
    symbolicWeakness:
      "A pure fuzzy planner can't read maze images and can't learn which walls are real " +
      "obstacles vs. false positives in noisy data.",
    combinedStrength:
      "Fuzzy rules turn confidence into a plan; plan success/failure trains the network. " +
      "The loop learns to balance confidence and global feasibility.",
    suggestedMethod: "rules",
    suggestedPattern: "learning-reasoning",
    dataset: "circle",
    complexity: 2,
  },
  {
    id: "word-search",
    title: "Word Search Solver",
    tagline: "Find words in a grid by reading letters and checking word-list rules interactively.",
    icon: "📝",
    description:
      "A word-search grid is shown as an image. A CNN reads letter positions; " +
      "a search algorithm interleaves word-list lookup with spatial reasoning: " +
      "'Is there a path in any direction that spells a known word?' The network and " +
      "solver communicate iteratively — the solver's found-words guide the network, " +
      "and the network's confidence refinement guides the search.",
    perception: "Recognize each letter in the grid from pixels.",
    reasoning: "Find paths (horizontally, vertically, diagonally, forward/reverse) that spell known words.",
    neuralWeakness:
      "A pure CNN can trace letter sequences locally but doesn't know which are " +
      "valid English words; it hallucinates solutions.",
    symbolicWeakness:
      "A pure word-list searcher can't read pixels and needs perfect letter labels " +
      "from an oracle.",
    combinedStrength:
      "Perception reads letters; the solver checks a dictionary. Iterative refinement " +
      "improves both: the solver's feedback corrects the network's uncertain letter reads.",
    suggestedMethod: "forward-chaining",
    suggestedPattern: "learning-reasoning",
    dataset: "circle",
    complexity: 2,
  },

  // ---- Knowledge-Augmented (Symbolic → Neural) ----
  {
    id: "guess-who",
    title: "Guess Who? Face Deduction",
    tagline: "Learn to identify faces by comparing attributes; symbolic rules guide visual learning.",
    icon: "🤔",
    description:
      "A Guess Who?-style game: a target face is hidden; you ask 'Does your person " +
      "wear glasses?' A CNN learns face attribute classifiers (glasses, hair color, " +
      "age, etc.) trained on attribute-annotated faces. Symbolic rules (constraint " +
      "propagation) maintain which faces remain possible. Uses CartoonSet or CelebA " +
      "with 12+ labeled attributes per face.",
    perception: "Classify visual attributes (glasses, hair, expression, age) from face images.",
    reasoning: "Maintain a set of possible target faces by eliminating those that don't match answers.",
    neuralWeakness:
      "A pure CNN can classify attributes but doesn't reason about which faces " +
      "are still plausible; it asks redundant questions.",
    symbolicWeakness:
      "Symbolic elimination needs attributes computed first; the network can't read " +
      "faces on its own.",
    combinedStrength:
      "Attribute learning is guided by which faces remain possible (symbolic feedback). " +
      "The network learns to focus on discriminative attributes. Constraint propagation " +
      "minimizes questions asked.",
    suggestedMethod: "kg",
    suggestedPattern: "reasoning-for-learning",
    dataset: "gauss",
    complexity: 2,
  },

  // ---- Exception: Reasoning-Oriented LLM (No Clean Split) ----
  {
    id: "mafia-werewolf",
    title: "Mafia / Werewolf Social Deduction",
    tagline: "No clean perceive→reason split: pure generative reasoning with dialogue and deception.",
    icon: "🎭",
    description:
      "In Mafia/Werewolf, players use dialogue and voting to deduce who the hidden " +
      "threat is. There's no separate perception phase: language itself IS the reasoning. " +
      "An LLM (not a clean neural-symbolic pipeline) must detect deception, build coalitions, " +
      "and persuade others. Training uses Mafiascum dialogue corpus, Ibraheem et al. (2022) " +
      "controlled games, Avalon NLU, or Werewolf Among Us multimodal data. " +
      "Exception: no playground, just flow.",
    perception: "N/A — language and social dynamics are the entire domain.",
    reasoning: "N/A — deduce hidden roles through dialogue, persuasion, and vote coordination.",
    neuralWeakness:
      "A pure generative LLM can produce fluent deception but has no systematic way " +
      "to reason about consistency or build reliable coalitions.",
    symbolicWeakness:
      "Pure symbolic rules (game state, voting) miss the persuasion and social dynamics " +
      "that win games.",
    combinedStrength:
      "N/A — this game is a pure reasoning challenge. LLMs excel at dialogue but struggle " +
      "with multi-turn deception and game theory.",
    suggestedMethod: "kg", // placeholder; N/A for this exception
    suggestedPattern: "learning-for-reasoning", // placeholder; N/A for this exception
    dataset: "circle",
    complexity: 3,
    isException: true,
  },
];

export function getSituation(id: string | null): Situation | undefined {
  return SITUATIONS.find((s) => s.id === id);
}
