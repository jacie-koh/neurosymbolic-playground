/**
 * Sudoku constraint-satisfaction solver using backtracking + constraint propagation.
 * 
 * Input: a partially-filled 9×9 grid (0 = empty)
 * Output: the solved grid, or null if unsolvable
 *
 * This is a standard CSP solver, not differentiable — used in the symbolic branch
 * to show how perfect constraint satisfaction works once the digits are read.
 */

export type SudokuGrid = number[][];

/** Check if a digit (1-9) can be placed at (row, col) without violating constraints. */
function isValid(grid: SudokuGrid, row: number, col: number, digit: number): boolean {
  // Check row
  for (let c = 0; c < 9; c++) {
    if (grid[row][c] === digit) return false;
  }

  // Check column
  for (let r = 0; r < 9; r++) {
    if (grid[r][col] === digit) return false;
  }

  // Check 3×3 box
  const boxRow = Math.floor(row / 3) * 3;
  const boxCol = Math.floor(col / 3) * 3;
  for (let r = boxRow; r < boxRow + 3; r++) {
    for (let c = boxCol; c < boxCol + 3; c++) {
      if (grid[r][c] === digit) return false;
    }
  }

  return true;
}

/** Find the next empty cell (0), or null if none. */
function findEmpty(grid: SudokuGrid): [number, number] | null {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (grid[r][c] === 0) {
        return [r, c];
      }
    }
  }
  return null;
}

/**
 * Solve a Sudoku puzzle using backtracking.
 * Modifies the grid in-place. Returns true if solvable, false otherwise.
 */
export function solveSudoku(grid: SudokuGrid): boolean {
  const empty = findEmpty(grid);
  if (!empty) return true; // solved

  const [row, col] = empty;
  for (let digit = 1; digit <= 9; digit++) {
    if (isValid(grid, row, col, digit)) {
      grid[row][col] = digit;
      if (solveSudoku(grid)) return true;
      grid[row][col] = 0; // backtrack
    }
  }
  return false;
}

/**
 * Apply constraint propagation to narrow down possibilities.
 * Returns a Map<cellIndex, Set<possibleDigits>> or null if contradiction.
 */
export function getPossibilities(grid: SudokuGrid): Map<number, Set<number>> | null {
  const poss = new Map<number, Set<number>>();

  // Initialize: empty cells can be 1-9, filled cells have no possibilities
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const idx = r * 9 + c;
      if (grid[r][c] === 0) {
        poss.set(idx, new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]));
      }
    }
  }

  // Eliminate based on filled cells
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (grid[r][c] !== 0) {
        const digit = grid[r][c];
        // Remove from row
        for (let cc = 0; cc < 9; cc++) {
          poss.get(r * 9 + cc)?.delete(digit);
        }
        // Remove from column
        for (let rr = 0; rr < 9; rr++) {
          const idx = rr * 9 + c;
          poss.get(idx)?.delete(digit);
        }
        // Remove from box
        const boxRow = Math.floor(r / 3) * 3;
        const boxCol = Math.floor(c / 3) * 3;
        for (let rr = boxRow; rr < boxRow + 3; rr++) {
          for (let cc = boxCol; cc < boxCol + 3; cc++) {
            const idx = rr * 9 + cc;
            poss.get(idx)?.delete(digit);
          }
        }
      }
    }
  }

  // Check for contradictions
  for (const [_idx, set] of poss.entries()) {
    if (set.size === 0) return null;
  }

  return poss;
}

/**
 * Copy a 9×9 grid.
 */
export function copyGrid(grid: SudokuGrid): SudokuGrid {
  return grid.map((row) => [...row]);
}

/**
 * Generate a random valid completed Sudoku grid.
 */
export function generateSudoku(): SudokuGrid {
  const grid: SudokuGrid = Array.from({ length: 9 }, () =>
    Array.from({ length: 9 }, () => 0)
  );

  function fillRandom(g: SudokuGrid, row: number = 0, col: number = 0): boolean {
    if (row === 9) return true;
    const nextRow = col === 8 ? row + 1 : row;
    const nextCol = (col + 1) % 9;

    // Try digits in random order
    const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9].sort(() => Math.random() - 0.5);
    for (const digit of digits) {
      if (isValid(g, row, col, digit)) {
        g[row][col] = digit;
        if (fillRandom(g, nextRow, nextCol)) return true;
        g[row][col] = 0;
      }
    }
    return false;
  }

  fillRandom(grid);
  return grid;
}

/**
 * Create a puzzle by removing digits from a completed grid.
 * Tries to maintain uniqueness by checking that each removal leaves a valid puzzle.
 * (Full uniqueness check is expensive; this is a heuristic.)
 */
export function generatePuzzle(difficulty: "easy" | "medium" | "hard" = "medium"): SudokuGrid {
  const completed = generateSudoku();
  const puzzle = completed.map((row) => [...row]);

  // Target number of empty cells (difficulty = difficulty)
  const targetEmpty = difficulty === "easy" ? 30 : difficulty === "medium" ? 40 : 50;
  let emptyCount = 0;

  // Randomly remove cells
  for (let attempt = 0; attempt < 500 && emptyCount < targetEmpty; attempt++) {
    const r = Math.floor(Math.random() * 9);
    const c = Math.floor(Math.random() * 9);
    if (puzzle[r][c] === 0) continue; // already empty

    const backup = puzzle[r][c];
    puzzle[r][c] = 0;

    // Simple heuristic: check if at least one solution exists
    // (Full uniqueness check would be slower)
    const test = puzzle.map((row) => [...row]);
    if (solveSudoku(test)) {
      emptyCount++;
    } else {
      puzzle[r][c] = backup;
    }
  }

  return puzzle;
}

/**
 * Check if a grid is completely filled and valid.
 */
export function isComplete(grid: SudokuGrid): boolean {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (grid[r][c] === 0) return false;
      if (!isValid(grid, r, c, grid[r][c])) return false;
    }
  }
  return true;
}

/**
 * Calculate accuracy: fraction of cells that the prediction matches the solution.
 */
export function accuracySudoku(predicted: SudokuGrid, solution: SudokuGrid): number {
  let correct = 0;
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (predicted[r][c] === solution[r][c]) correct++;
    }
  }
  return correct / 81;
}
