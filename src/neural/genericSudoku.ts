/**
 * Size-generic Sudoku constraint checking + backtracking solve, for the trace
 * debugger (which ships 4x4 and 9x9 curated puzzles). Deliberately separate
 * from sudokuSolver.ts, which is hardcoded to 9x9 for the toy MLP demo.
 *
 * This is a plain backtracking search, not the offline pipeline's Z3 encoding.
 * It exists so the debugger can honestly "rerun" after a user edits a reading,
 * without depending on a live SMT solver in the browser.
 */

export type Grid = number[][];

function boxSize(size: number): number {
  return Math.round(Math.sqrt(size));
}

export interface Conflict {
  row: number;
  col: number;
  digit: number;
  with: [number, number];
  kind: "row" | "col" | "box";
}

/** Find every duplicate-digit conflict in a (possibly partial) grid. */
export function findConflicts(grid: Grid): Conflict[] {
  const size = grid.length;
  const box = boxSize(size);
  const conflicts: Conflict[] = [];

  const check = (cells: [number, number][], kind: Conflict["kind"]) => {
    const seen = new Map<number, [number, number]>();
    for (const [r, c] of cells) {
      const v = grid[r][c];
      if (v === 0) continue;
      const prior = seen.get(v);
      if (prior) {
        conflicts.push({ row: r, col: c, digit: v, with: prior, kind });
      } else {
        seen.set(v, [r, c]);
      }
    }
  };

  for (let r = 0; r < size; r++) {
    check(Array.from({ length: size }, (_, c) => [r, c]), "row");
  }
  for (let c = 0; c < size; c++) {
    check(Array.from({ length: size }, (_, r) => [r, c]), "col");
  }
  for (let br = 0; br < size; br += box) {
    for (let bc = 0; bc < size; bc += box) {
      const cells: [number, number][] = [];
      for (let r = br; r < br + box; r++)
        for (let c = bc; c < bc + box; c++) cells.push([r, c]);
      check(cells, "box");
    }
  }
  return conflicts;
}

function canPlace(grid: Grid, row: number, col: number, digit: number): boolean {
  const size = grid.length;
  const box = boxSize(size);
  for (let i = 0; i < size; i++) {
    if (grid[row][i] === digit || grid[i][col] === digit) return false;
  }
  const br = Math.floor(row / box) * box;
  const bc = Math.floor(col / box) * box;
  for (let r = br; r < br + box; r++)
    for (let c = bc; c < bc + box; c++) if (grid[r][c] === digit) return false;
  return true;
}

export interface SolveResult {
  status: "sat" | "unsat";
  solution: Grid | null;
}

/**
 * Backtracking solve. Row-major first-empty-cell order (no ordering heuristic)
 * can pathologically blow up on some boards — e.g. the curated 16x16 hex trace
 * takes 5M+ trial placements and never finishes in reasonable time — so this
 * delegates to the same minimum-remaining-values search solveGenericWithSteps
 * uses for animated playback, just discarding the recorded steps.
 */
export function solveGeneric(input: Grid): SolveResult {
  const { status, solution } = solveGenericWithSteps(input);
  return { status, solution };
}

/** One mutation of the backtracking search: digit>0 is a trial placement, digit===0 undoes it. */
export interface SolveStep {
  row: number;
  col: number;
  digit: number;
}

export interface SolveTrace extends SolveResult {
  steps: SolveStep[];
}

/**
 * Minimum-remaining-values backtracking (picks the empty cell with fewest legal
 * digits first, not row-major scan order) so the recorded trace is short enough
 * to animate live even on a 16x16 board — naive row-major order can thrash for
 * thousands of trial placements on sparser boards.
 */
export function solveGenericWithSteps(input: Grid): SolveTrace {
  const size = input.length;
  const grid = input.map((row) => [...row]);
  const steps: SolveStep[] = [];

  function candidatesFor(row: number, col: number): number[] {
    const out: number[] = [];
    for (let digit = 1; digit <= size; digit++) {
      if (canPlace(grid, row, col, digit)) out.push(digit);
    }
    return out;
  }

  function pickCell(): { row: number; col: number; candidates: number[] } | null {
    let best: { row: number; col: number; candidates: number[] } | null = null;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (grid[r][c] !== 0) continue;
        const candidates = candidatesFor(r, c);
        if (!best || candidates.length < best.candidates.length) {
          best = { row: r, col: c, candidates };
          if (candidates.length <= 1) return best;
        }
      }
    }
    return best;
  }

  function backtrack(): boolean {
    const picked = pickCell();
    if (!picked) return true;
    const { row, col, candidates } = picked;
    for (const digit of candidates) {
      grid[row][col] = digit;
      steps.push({ row, col, digit });
      if (backtrack()) return true;
      grid[row][col] = 0;
      steps.push({ row, col, digit: 0 });
    }
    return false;
  }

  if (findConflicts(grid).length > 0) return { status: "unsat", solution: null, steps: [] };
  const ok = backtrack();
  return { status: ok ? "sat" : "unsat", solution: ok ? grid : null, steps };
}
