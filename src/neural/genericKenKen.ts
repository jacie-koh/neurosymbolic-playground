/**
 * Size-generic KenKen constraint checking + backtracking solve, for the trace
 * debugger. Mirrors the arithmetic semantics of the standalone backend's
 * solve_grid (row/column uniqueness + cage target arithmetic), but is a plain
 * backtracking search here, not the offline Z3 encoding.
 */

export type Op = "add" | "sub" | "mul" | "div" | "";

export interface Cage {
  cells: [number, number][];
  op: Op;
  target: number;
}

export type Grid = number[][];

function cageValue(op: Op, values: number[]): number | null {
  switch (op) {
    case "":
      return values[0];
    case "add":
      return values.reduce((a, b) => a + b, 0);
    case "mul":
      return values.reduce((a, b) => a * b, 1);
    case "sub":
      if (values.length !== 2) return null;
      return Math.abs(values[0] - values[1]);
    case "div": {
      if (values.length !== 2) return null;
      const [a, b] = values;
      const hi = Math.max(a, b);
      const lo = Math.min(a, b);
      return lo !== 0 && hi % lo === 0 ? hi / lo : null;
    }
  }
}

export function cageSatisfied(cage: Cage, grid: Grid): "satisfied" | "violated" | "pending" {
  const values = cage.cells.map(([r, c]) => grid[r][c]);
  if (values.some((v) => v === 0)) return "pending";
  const v = cageValue(cage.op, values);
  return v === cage.target ? "satisfied" : "violated";
}

export interface KenKenSolveResult {
  status: "sat" | "unsat";
  solution: Grid | null;
}

/** One mutation of the backtracking search: digit>0 is a trial placement, digit===0
 * undoes it. deadEnd steps (digit===0, deadEnd: true) are the actual dead-end moment
 * -- this cell has no legal digit left at all, given the current trial grid -- as
 * opposed to a plain undo, which just means a deeper cell dead-ended and this trial
 * is being abandoned to try the next candidate. */
export interface KenKenSolveStep {
  row: number;
  col: number;
  digit: number;
  deadEnd?: boolean;
  reason?: string;
}

export interface KenKenSolveTrace extends KenKenSolveResult {
  steps: KenKenSolveStep[];
}

/**
 * Same constraints as solveKenKen, but a minimum-remaining-values backtracking
 * search (picks whichever empty cell has the fewest legal digits left, instead of
 * scanning row-major) so the recorded trial/undo trace is short enough to animate
 * live — plain row-major backtracking on a 6x6+ handwritten grid can run into the
 * hundreds of thousands of trial placements, useless for a real-time playback.
 */
export function solveKenKenWithSteps(size: number, cages: Cage[]): KenKenSolveTrace {
  const grid: Grid = Array.from({ length: size }, () => Array(size).fill(0));
  const cageOf = new Map<string, Cage>();
  for (const cage of cages) for (const [r, c] of cage.cells) cageOf.set(`${r},${c}`, cage);
  const steps: KenKenSolveStep[] = [];

  function rowColOk(row: number, col: number, digit: number): boolean {
    for (let i = 0; i < size; i++) {
      if (grid[row][i] === digit || grid[i][col] === digit) return false;
    }
    return true;
  }

  /** Whether the cage stays viable given the cells filled so far (not just once complete). */
  function partialOk(cage: Cage): boolean {
    const filled = cage.cells.filter(([r, c]) => grid[r][c] !== 0);
    const remaining = cage.cells.length - filled.length;
    const values = filled.map(([r, c]) => grid[r][c]);
    if (cage.op === "add") {
      const sum = values.reduce((a, b) => a + b, 0);
      return remaining === 0 ? sum === cage.target : sum < cage.target && sum + remaining <= cage.target;
    }
    if (cage.op === "mul") {
      const product = values.reduce((a, b) => a * b, 1);
      return remaining === 0 ? product === cage.target : cage.target % product === 0;
    }
    if (remaining > 0) return true;
    if (cage.op === "sub") return Math.abs(values[0] - values[1]) === cage.target;
    if (cage.op === "div") {
      const hi = Math.max(...values);
      const lo = Math.min(...values);
      return lo !== 0 && hi % lo === 0 && hi / lo === cage.target;
    }
    return values[0] === cage.target;
  }

  function candidatesFor(row: number, col: number): number[] {
    const cage = cageOf.get(`${row},${col}`);
    const out: number[] = [];
    for (let digit = 1; digit <= size; digit++) {
      if (!rowColOk(row, col, digit)) continue;
      grid[row][col] = digit;
      const ok = !cage || partialOk(cage);
      grid[row][col] = 0;
      if (ok) out.push(digit);
    }
    return out;
  }

  /** Most-constrained-cell-first: pick the empty cell with fewest legal digits left. */
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

  /** Names one real, specific reason every digit is blocked at (row,col) -- the first
   * digit found blocked, and whether it's a row/column duplicate or this cell's cage
   * arithmetic, rather than a generic "no candidates" message. */
  function explainDeadEnd(row: number, col: number): string {
    const cage = cageOf.get(`${row},${col}`);
    for (let digit = 1; digit <= size; digit++) {
      if (!rowColOk(row, col, digit)) {
        for (let i = 0; i < size; i++) {
          if (grid[row][i] === digit) return `digit ${digit} is already at (${row + 1},${i + 1}) in this row`;
          if (grid[i][col] === digit) return `digit ${digit} is already at (${i + 1},${col + 1}) in this column`;
        }
      }
      if (cage) {
        grid[row][col] = digit;
        const ok = partialOk(cage);
        grid[row][col] = 0;
        if (!ok) {
          const opLabel = cage.op === "add" ? "sum" : cage.op === "mul" ? "product" : cage.op === "sub" ? "difference" : cage.op === "div" ? "quotient" : "value";
          return `digit ${digit} would leave this cage's ${opLabel} unable to reach ${cage.target}`;
        }
      }
    }
    return `every digit 1-${size} conflicts with this cell's row, column, or cage`;
  }

  function backtrack(filled: number): boolean {
    if (filled === size * size) return true;
    const picked = pickCell();
    if (!picked) return false;
    const { row, col, candidates } = picked;
    if (candidates.length === 0) {
      steps.push({ row, col, digit: 0, deadEnd: true, reason: explainDeadEnd(row, col) });
      return false;
    }
    for (const digit of candidates) {
      grid[row][col] = digit;
      steps.push({ row, col, digit });
      if (backtrack(filled + 1)) return true;
      grid[row][col] = 0;
      steps.push({ row, col, digit: 0 });
    }
    return false;
  }

  if (cages.some((cage) => cage.cells.some(([r, c]) => r < 0 || r >= size || c < 0 || c >= size))) {
    return { status: "unsat", solution: null, steps: [] };
  }

  const ok = backtrack(0);
  return { status: ok ? "sat" : "unsat", solution: ok ? grid.map((row) => [...row]) : null, steps };
}

export function solveKenKen(size: number, cages: Cage[]): KenKenSolveResult {
  const grid: Grid = Array.from({ length: size }, () => Array(size).fill(0));
  const cageOf = new Map<string, Cage>();
  for (const cage of cages) for (const [r, c] of cage.cells) cageOf.set(`${r},${c}`, cage);

  function rowColOk(row: number, col: number, digit: number): boolean {
    for (let i = 0; i < size; i++) {
      if (grid[row][i] === digit || grid[i][col] === digit) return false;
    }
    return true;
  }

  function cellsFilled(cage: Cage): boolean {
    return cage.cells.every(([r, c]) => grid[r][c] !== 0);
  }

  function backtrack(idx: number): boolean {
    if (idx === size * size) return true;
    const row = Math.floor(idx / size);
    const col = idx % size;
    for (let digit = 1; digit <= size; digit++) {
      if (!rowColOk(row, col, digit)) continue;
      grid[row][col] = digit;
      const cage = cageOf.get(`${row},${col}`);
      const ok = !cage || !cellsFilled(cage) || cageSatisfied(cage, grid) === "satisfied";
      if (ok && backtrack(idx + 1)) return true;
      grid[row][col] = 0;
    }
    return false;
  }

  // A cage referencing an out-of-range cell (malformed edit) can never be satisfied.
  if (cages.some((cage) => cage.cells.some(([r, c]) => r < 0 || r >= size || c < 0 || c >= size))) {
    return { status: "unsat", solution: null };
  }

  const ok = backtrack(0);
  return ok ? { status: "sat", solution: grid.map((row) => [...row]) } : { status: "unsat", solution: null };
}
