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

/** One mutation of the backtracking search: digit>0 is a trial placement, digit===0
 * undoes it. deadEnd steps (digit===0, deadEnd: true) are the actual dead-end moment
 * -- this cell has no legal digit left at all, given the current trial grid -- as
 * opposed to a plain undo, which just means a deeper cell dead-ended and this trial
 * is being abandoned to try the next candidate.
 *
 * correction steps (see solveWithCorrectionLoop) are a different phase entirely:
 * confidence-ranked retries on a GIVEN cell's real CNN reading, mirroring the real
 * offline pipeline's bounded best-first search (puzzlelab/visual.py), which only
 * ever runs when the given digits directly conflict with each other. */
export interface SolveStep {
  row: number;
  col: number;
  digit: number;
  deadEnd?: boolean;
  reason?: string;
  correction?: { kind: "conflict-found" | "try" | "revert" | "corrected" | "give-up"; confidence?: number };
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

  /** Names one real, specific reason every digit is blocked at (row,col) -- the first
   * digit found blocked, and the exact occupied cell blocking it -- rather than a
   * generic "no candidates" message. */
  function explainDeadEnd(row: number, col: number): string {
    const box = boxSize(size);
    for (let digit = 1; digit <= size; digit++) {
      for (let i = 0; i < size; i++) {
        if (grid[row][i] === digit) return `digit ${digit} is already at (${row + 1},${i + 1}) in this row`;
        if (grid[i][col] === digit) return `digit ${digit} is already at (${i + 1},${col + 1}) in this column`;
      }
      const br = Math.floor(row / box) * box;
      const bc = Math.floor(col / box) * box;
      for (let r = br; r < br + box; r++) {
        for (let c = bc; c < bc + box; c++) {
          if (grid[r][c] === digit) return `digit ${digit} is already at (${r + 1},${c + 1}) in this box`;
        }
      }
    }
    return `every digit 1-${size} conflicts somewhere in this row, column, or box`;
  }

  function backtrack(): boolean {
    const picked = pickCell();
    if (!picked) return true;
    const { row, col, candidates } = picked;
    if (candidates.length === 0) {
      steps.push({ row, col, digit: 0, deadEnd: true, reason: explainDeadEnd(row, col) });
      return false;
    }
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

/**
 * Explains a real, already-known solution (the offline Z3-verified answer) cell
 * by cell, in the same row-major reveal order the debugger plays it back in --
 * Z3's own internal decision process isn't recorded, so this isn't "how Z3
 * decided it," but it IS a real fact about the puzzle: given only the given
 * digits plus whichever cells have been revealed so far, exactly whether every
 * other digit is already ruled out (forced) or several are still legal (not yet
 * decided by constraints alone) -- an honest thing to show, not a gap to paper
 * over, mirroring explainRevealSteps() in genericZebra.ts.
 */
export function explainRevealSteps(given: Grid, solution: Grid): SolveStep[] {
  const size = given.length;
  const grid = given.map((row) => [...row]);
  const steps: SolveStep[] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (given[r][c] !== 0) continue;
      const trueDigit = solution[r][c];
      const legal: number[] = [];
      for (let d = 1; d <= size; d++) if (canPlace(grid, r, c, d)) legal.push(d);
      const reason =
        legal.length <= 1
          ? "forced — every other digit is already ruled out by this row, column, or box"
          : `${legal.length} digits (${legal.join(", ")}) were still legal here given what's revealed so far — not decided by constraints alone yet`;
      steps.push({ row: r, col: c, digit: trueDigit, reason });
      grid[r][c] = trueDigit;
    }
  }
  return steps;
}

/** A real ranked alternative reading for a given cell, and its real CNN confidence. */
interface GivenChoice {
  row: number;
  col: number;
  digit: number;
  confidence: number;
}

interface CorrectionAttempt {
  changes: { row: number; col: number; from: number; to: number; confidence: number }[];
  accepted: boolean;
}

export interface CorrectionLoopResult {
  /** Whether the loop actually engaged -- only when the given digits directly
   * conflict, matching the real pipeline (a misread that's still satisfiable, a
   * classic symmetric-swap ambiguity, gives the solver nothing to react to). */
  engaged: boolean;
  status: "sat" | "unsat";
  /** The given grid with any accepted corrections applied (unchanged if !engaged
   * or no correction was accepted). */
  correctedGiven: Grid;
  attempts: CorrectionAttempt[];
  steps: SolveStep[];
}

/**
 * Client-side port of the real offline correction loop (puzzlelab/visual.py): a
 * bounded best-first search over up to two ranked alternative readings for the
 * GIVEN cells directly implicated in a conflict (checked first, by confidence),
 * falling back to every other given cell's alternatives if that's not enough.
 * Only ever engages when the given digits directly conflict -- exactly the real
 * pipeline's own limitation, not a simplification made here.
 */
export function solveWithCorrectionLoop(given: Grid, topKByCell: Record<string, [number, number][]>, maxAttempts = 25): CorrectionLoopResult {
  const board = given.map((row) => [...row]);
  const directConflicts = findConflicts(board);
  if (directConflicts.length === 0) {
    return { engaged: false, status: "sat", correctedGiven: board, attempts: [], steps: [] };
  }

  const steps: SolveStep[] = [];
  const first = directConflicts[0];
  steps.push({
    row: first.row,
    col: first.col,
    digit: first.digit,
    correction: { kind: "conflict-found" },
    reason: `digit ${first.digit} at (${first.row + 1},${first.col + 1}) conflicts with (${first.with[0] + 1},${first.with[1] + 1}) in the same ${first.kind === "box" ? "box" : first.kind} — the given readings directly disagree.`,
  });

  const suspects = new Set<string>();
  for (const c of directConflicts) {
    suspects.add(`${c.row},${c.col}`);
    suspects.add(`${c.with[0]},${c.with[1]}`);
  }

  const choices: GivenChoice[] = [];
  for (const [key, topK] of Object.entries(topKByCell)) {
    const [row, col] = key.split(",").map(Number);
    if (given[row][col] === 0) continue;
    for (const [digit, confidence] of topK) {
      if (digit !== board[row][col] && digit >= 1 && digit <= given.length) choices.push({ row, col, digit, confidence });
    }
  }

  function penalty(row: number, col: number, confidence: number): number {
    return (1 - confidence) + (suspects.has(`${row},${col}`) ? 0 : 1);
  }

  function fullySatisfiable(g: Grid): boolean {
    if (findConflicts(g).length > 0) return false;
    return solveGeneric(g).status === "sat";
  }

  let queue: { changes: GivenChoice[]; cost: number }[] = choices.map((c) => ({ changes: [c], cost: penalty(c.row, c.col, c.confidence) }));
  const visited = new Set<string>();
  const attempts: CorrectionAttempt[] = [];
  let tries = 0;

  while (queue.length > 0 && tries < maxAttempts) {
    queue.sort((a, b) => a.cost - b.cost);
    const node = queue.shift()!;
    const key = node.changes.map((c) => `${c.row},${c.col},${c.digit}`).sort().join("|");
    if (visited.has(key)) continue;
    visited.add(key);

    const candidate = board.map((row) => [...row]);
    for (const c of node.changes) candidate[c.row][c.col] = c.digit;
    tries++;
    const accepted = fullySatisfiable(candidate);
    attempts.push({ changes: node.changes.map((c) => ({ row: c.row, col: c.col, from: board[c.row][c.col], to: c.digit, confidence: c.confidence })), accepted });

    for (const c of node.changes) {
      steps.push({ row: c.row, col: c.col, digit: c.digit, correction: { kind: accepted ? "corrected" : "try", confidence: c.confidence } });
    }
    if (accepted) {
      return { engaged: true, status: "sat", correctedGiven: candidate, attempts, steps };
    }
    for (const c of node.changes) {
      steps.push({ row: c.row, col: c.col, digit: board[c.row][c.col], correction: { kind: "revert", confidence: c.confidence } });
    }
    if (node.changes.length === 1) {
      for (const c of choices) {
        if (c.row === node.changes[0].row && c.col === node.changes[0].col) continue;
        queue.push({ changes: [...node.changes, c], cost: node.cost + 2 - c.confidence });
      }
    }
  }

  steps.push({
    row: first.row,
    col: first.col,
    digit: board[first.row][first.col],
    correction: { kind: "give-up" },
    reason: `Tried ${attempts.length} ranked-alternative combination(s) from the real CNN readings — none resolve the conflict within budget.`,
  });
  return { engaged: true, status: "unsat", correctedGiven: board, attempts, steps };
}
