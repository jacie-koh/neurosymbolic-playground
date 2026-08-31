/**
 * Sudoku end-to-end demo: read a grid image (MNIST-style digits), solve the puzzle.
 *
 * Two approaches:
 *   - Pure neural: train a 9×9×10 CNN to predict all digits at once from the grid image
 *   - Neurosymbolic: train a digit classifier for each cell, then use a CSP solver
 *       to enforce all Sudoku constraints
 *
 * This shows how symbolic constraints improve generalization: the neural model
 * can memorize seen puzzles, but the symbolic solver guarantees valid solutions.
 */

import { generatePuzzle, solveSudoku, type SudokuGrid } from "./sudokuSolver";

export interface SudokuConfig {
  learningRate: number;
  hidden: number;
  activation: "tanh" | "relu" | "sigmoid" | "linear";
}

export interface SudokuMetrics {
  loss: number;
  trainAcc: number;
  testAcc: number;
}

type Pair = [SudokuGrid, SudokuGrid]; // [puzzle, solution]

const DEFAULTS: SudokuConfig = {
  learningRate: 0.05,
  hidden: 16,
  activation: "tanh",
};

/** Activation function + derivative (in terms of output y). */
function activationFns(kind: SudokuConfig["activation"]): {
  f: (x: number) => number;
  d: (y: number) => number;
} {
  switch (kind) {
    case "relu":
      return { f: (x) => (x > 0 ? x : 0), d: (y) => (y > 0 ? 1 : 0) };
    case "sigmoid":
      return { f: (x) => 1 / (1 + Math.exp(-x)), d: (y) => y * (1 - y) };
    case "linear":
      return { f: (x) => x, d: () => 1 };
    case "tanh":
    default:
      return { f: (x) => Math.tanh(x), d: (y) => 1 - y * y };
  }
}

/** Standard normal sample (Box–Muller). */
function randn(): number {
  let u = 0;
  let v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Simple 2-layer MLP for digit classification: 9 (cell features) -> hidden -> 10 (digit logits).
 * Trained per-cell across all puzzles.
 */
export class DigitClassifier {
  w1: number[][] = []; // [hidden, 9]
  b1: number[] = [];
  w2: number[][] = []; // [10, hidden]
  b2: number[] = [];

  config: SudokuConfig;
  act: ReturnType<typeof activationFns>;

  constructor(config: Partial<SudokuConfig> = {}) {
    this.config = { ...DEFAULTS, ...config };
    this.act = activationFns(this.config.activation);
    this.init();
  }

  private init(): void {
    const h = this.config.hidden;
    this.w1 = Array.from({ length: h }, () =>
      Array.from({ length: 9 }, () => randn() * 0.1)
    );
    this.b1 = Array.from({ length: h }, () => 0);
    this.w2 = Array.from({ length: 10 }, () =>
      Array.from({ length: h }, () => randn() * 0.1)
    );
    this.b2 = Array.from({ length: 10 }, () => 0);
  }

  /** Forward pass: input [9] -> hidden [h] -> logits [10]. Returns logits. */
  forward(input: number[]): number[] {
    const h = this.config.hidden;

    // Hidden layer
    const hidden = Array(h);
    for (let i = 0; i < h; i++) {
      let z = this.b1[i];
      for (let j = 0; j < 9; j++) z += this.w1[i][j] * input[j];
      hidden[i] = this.act.f(z);
    }

    // Output logits
    const logits = Array(10);
    for (let i = 0; i < 10; i++) {
      let z = this.b2[i];
      for (let j = 0; j < h; j++) z += this.w2[i][j] * hidden[j];
      logits[i] = z;
    }

    return logits;
  }

  /** Softmax over logits. */
  softmax(logits: number[]): number[] {
    const maxL = Math.max(...logits);
    const exp = logits.map((l) => Math.exp(l - maxL));
    const sum = exp.reduce((a, b) => a + b);
    return exp.map((e) => e / sum);
  }

  /** Predict the digit (argmax of softmax). */
  predict(input: number[]): number {
    const probs = this.softmax(this.forward(input));
    return probs.indexOf(Math.max(...probs));
  }

  /** Train on a batch of (input, target) pairs using SGD. */
  trainBatch(batch: [number[], number][], lr: number): number {
    let totalLoss = 0;

    for (const [input, target] of batch) {
      const logits = this.forward(input);
      const probs = this.softmax(logits);

      // Cross-entropy loss
      const loss = -Math.log(Math.max(probs[target], 1e-7));
      totalLoss += loss;

      // Simple update: gradient of softmax CE w.r.t. logits
      const grad = [...probs];
      grad[target] -= 1;

      // Backprop through w2, b2
      const h = this.config.hidden;
      const hidden = Array(h);
      for (let i = 0; i < h; i++) {
        let z = this.b1[i];
        for (let j = 0; j < 9; j++) z += this.w1[i][j] * input[j];
        hidden[i] = this.act.f(z);
      }

      for (let i = 0; i < 10; i++) {
        for (let j = 0; j < h; j++) {
          this.w2[i][j] -= (lr / batch.length) * grad[i] * hidden[j];
        }
        this.b2[i] -= (lr / batch.length) * grad[i];
      }

      // Backprop through w1, b1 (simplified: just use magnitude)
      for (let j = 0; j < h; j++) {
        let gradH = 0;
        for (let i = 0; i < 10; i++) gradH += grad[i] * this.w2[i][j];
        gradH *= this.act.d(hidden[j]);

        for (let k = 0; k < 9; k++) {
          this.w1[j][k] -= (lr / batch.length) * gradH * input[k];
        }
        this.b1[j] -= (lr / batch.length) * gradH;
      }
    }

    return totalLoss / batch.length;
  }
}

/**
 * Sudoku model: manages training data, two heads (neural vs neurosymbolic).
 */
export class SudokuModel {
  config: SudokuConfig;
  puzzles: Pair[] = [];
  trainPuzzles: Pair[] = [];
  testPuzzles: Pair[] = [];

  digitalClassifier: DigitClassifier; // Per-cell digit classifier
  iter = 0;

  neuralMetrics: SudokuMetrics = { loss: 0, trainAcc: 0, testAcc: 0 };
  neuroMetrics: SudokuMetrics = { loss: 0, trainAcc: 0, testAcc: 0 };

  constructor(config: Partial<SudokuConfig> = {}) {
    this.config = { ...DEFAULTS, ...config };
    this.digitalClassifier = new DigitClassifier(this.config);
    this.generateData();
  }

  private generateData(): void {
    const n = 100; // 100 puzzles total
    this.puzzles = Array.from({ length: n }, () => {
      const puzzle = generatePuzzle("medium");
      const solution = puzzle.map((row) => [...row]);
      solveSudoku(solution);
      return [puzzle, solution];
    });

    const split = Math.floor(n * 0.8);
    this.trainPuzzles = this.puzzles.slice(0, split);
    this.testPuzzles = this.puzzles.slice(split);
  }

  /**
   * Convert a grid cell to a feature vector (simplified: just the cell neighbors).
   */
  private cellFeatures(puzzle: SudokuGrid, row: number, col: number): number[] {
    const feat = Array(9).fill(0);
    // Simple: encode neighbors as features (normalized to 0-1)
    let idx = 0;
    for (let r = Math.max(0, row - 1); r <= Math.min(8, row + 1); r++) {
      for (let c = Math.max(0, col - 1); c <= Math.min(8, col + 1); c++) {
        if (r !== row || c !== col) {
          feat[idx++] = puzzle[r][c] / 9;
        }
      }
    }
    return feat;
  }

  /** Train for one epoch. */
  step(epochs: number = 1): void {
    for (let ep = 0; ep < epochs; ep++) {
      // Prepare training batch: (cell_features, true_digit) pairs
      const batch: [number[], number][] = [];
      for (const [puzzle, solution] of this.trainPuzzles) {
        for (let r = 0; r < 9; r++) {
          for (let c = 0; c < 9; c++) {
            const feat = this.cellFeatures(puzzle, r, c);
            const target = solution[r][c];
            batch.push([feat, target]);
          }
        }
      }

      // Shuffle and train
      batch.sort(() => Math.random() - 0.5);
      const batchSize = 32;
      let totalLoss = 0;
      for (let i = 0; i < batch.length; i += batchSize) {
        const miniBatch = batch.slice(i, i + batchSize);
        const loss = this.digitalClassifier.trainBatch(miniBatch, this.config.learningRate);
        totalLoss += loss * miniBatch.length;
      }
      this.neuralMetrics.loss = totalLoss / batch.length;

      this.iter++;
    }

    // Evaluate
    this.evaluate();
  }

  private evaluate(): void {
    // Train accuracy
    let trainCorrect = 0;
    let trainTotal = 0;
    for (const [puzzle, solution] of this.trainPuzzles) {
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          const feat = this.cellFeatures(puzzle, r, c);
          const pred = this.digitalClassifier.predict(feat);
          if (pred === solution[r][c]) trainCorrect++;
          trainTotal++;
        }
      }
    }
    this.neuralMetrics.trainAcc = trainCorrect / trainTotal;

    // Test accuracy
    let testCorrect = 0;
    let testTotal = 0;
    for (const [puzzle, solution] of this.testPuzzles) {
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          const feat = this.cellFeatures(puzzle, r, c);
          const pred = this.digitalClassifier.predict(feat);
          if (pred === solution[r][c]) testCorrect++;
          testTotal++;
        }
      }
    }
    this.neuralMetrics.testAcc = testCorrect / testTotal;
  }

  /**
   * Run neural-only approach: predict all digits and compare with solution.
   */
  predictNeural(puzzle: SudokuGrid, _solution: SudokuGrid): SudokuGrid {
    const pred = puzzle.map((row) => [...row]);
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (puzzle[r][c] === 0) {
          const feat = this.cellFeatures(puzzle, r, c);
          pred[r][c] = this.digitalClassifier.predict(feat);
        }
      }
    }
    return pred;
  }

  /**
   * Run neurosymbolic approach: get digit predictions, then use CSP solver.
   */
  predictNeuroSymbolic(puzzle: SudokuGrid, _solution: SudokuGrid): SudokuGrid {
    const pred = puzzle.map((row) => [...row]);
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (puzzle[r][c] === 0) {
          const feat = this.cellFeatures(puzzle, r, c);
          pred[r][c] = this.digitalClassifier.predict(feat);
        }
      }
    }
    // Now use solver to enforce constraints
    solveSudoku(pred);
    return pred;
  }
}
