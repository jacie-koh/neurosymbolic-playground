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

export function cageKey(cage: { cells: [number, number][] }): string {
  return cage.cells.map(([r, c]) => `${r}:${c}`).join("|");
}

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
 * is being abandoned to try the next candidate.
 *
 * correction steps (see solveKenKenWithCorrectionLoop) are a different phase: a
 * confidence-ranked retry on a whole cage's real CNN reading, reported at that
 * cage's origin cell since a cage correction isn't a single-cell value. row/col/
 * digit carry no grid meaning for these -- only correction.kind/confidence and
 * reason do. */
export interface KenKenSolveStep {
  row: number;
  col: number;
  digit: number;
  deadEnd?: boolean;
  reason?: string;
  correction?: { kind: "conflict-found" | "try" | "revert" | "corrected" | "give-up"; confidence?: number; op?: Op; target?: number };
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

/**
 * Explains a real, already-known solution (the offline Z3-verified answer) cell
 * by cell, in the same row-major reveal order the debugger plays it back in --
 * Z3's own internal decision process isn't recorded, so this isn't "how Z3
 * decided it," but it IS a real fact about the puzzle: given only the row/column
 * uniqueness and cage arithmetic constraints plus whichever cells have been
 * revealed so far, exactly whether every other digit is already ruled out
 * (forced) or several are still legal (not yet decided by constraints alone).
 * Mirrors explainRevealSteps() in genericSudoku.ts and genericZebra.ts.
 */
export function explainRevealSteps(size: number, cages: Cage[], solution: Grid): KenKenSolveStep[] {
  const grid: Grid = Array.from({ length: size }, () => Array(size).fill(0));
  const cageOf = new Map<string, Cage>();
  for (const cage of cages) for (const [r, c] of cage.cells) cageOf.set(`${r},${c}`, cage);

  function rowColOk(row: number, col: number, digit: number): boolean {
    for (let i = 0; i < size; i++) if (grid[row][i] === digit || grid[i][col] === digit) return false;
    return true;
  }
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

  const steps: KenKenSolveStep[] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const trueDigit = solution[r][c];
      const cage = cageOf.get(`${r},${c}`);
      const legal: number[] = [];
      for (let d = 1; d <= size; d++) {
        if (!rowColOk(r, c, d)) continue;
        grid[r][c] = d;
        const ok = !cage || partialOk(cage);
        grid[r][c] = 0;
        if (ok) legal.push(d);
      }
      const reason =
        legal.length <= 1
          ? "forced — every other digit is already ruled out by this row, column, or cage"
          : `${legal.length} digits (${legal.join(", ")}) were still legal here given what's revealed so far — not decided by constraints alone yet`;
      steps.push({ row: r, col: c, digit: trueDigit, reason });
      grid[r][c] = trueDigit;
    }
  }
  return steps;
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

/** Character classes 10-13 are the trailing operator glyph on a multi-cell cage's
 * label (0-9 are digits) -- same mapping the debugger's own CLASS_LABEL/OP_SYMBOL
 * use for display. */
const CLASS_TO_OP: Record<number, Op> = { 10: "add", 11: "div", 12: "mul", 13: "sub" };

export interface CageReadCandidate {
  op: Op;
  target: number;
  confidence: number;
}

/**
 * Real alternative cage readings decoded from the CNN's actual per-position ranked
 * classes (topK: one ranked list per character position in the cage's label) --
 * the cartesian product of the top few alternatives per position, decoded with the
 * same rule the CNN's own single reading uses (digits then a trailing operator for
 * multi-cell cages; a single digit, no operator, for one-cell cages), each with a
 * real confidence (the average of the position-wise probabilities actually read).
 */
export function cageReadAlternatives(topK: [number, number][][], cellCount: number, perPositionCap = 3): CageReadCandidate[] {
  if (topK.length === 0) return [];
  const positions = topK.map((ranked) => ranked.slice(0, perPositionCap));

  function decode(classes: number[]): { op: Op; target: number } | null {
    if (cellCount === 1) {
      if (classes.some((c) => c > 9)) return null;
      return { op: "", target: Number(classes.map(String).join("")) };
    }
    const op = CLASS_TO_OP[classes[classes.length - 1]];
    if (!op) return null;
    const digits = classes.slice(0, -1);
    if (digits.length === 0 || digits.some((c) => c > 9)) return null;
    return { op, target: Number(digits.map(String).join("")) };
  }

  const combos: { cls: number; p: number }[][] = [[]];
  for (const ranked of positions) {
    const next: { cls: number; p: number }[][] = [];
    for (const partial of combos) for (const [cls, p] of ranked) next.push([...partial, { cls, p }]);
    combos.length = 0;
    combos.push(...next);
  }

  const seen = new Set<string>();
  const results: CageReadCandidate[] = [];
  for (const combo of combos) {
    const decoded = decode(combo.map((c) => c.cls));
    if (!decoded) continue;
    const key = `${decoded.op}:${decoded.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ ...decoded, confidence: combo.reduce((s, c) => s + c.p, 0) / combo.length });
  }
  results.sort((a, b) => b.confidence - a.confidence);
  return results;
}

export interface KenKenCorrectionResult {
  /** Whether the loop actually engaged -- only when the cage readings as given
   * can't be jointly solved at all. */
  engaged: boolean;
  status: "sat" | "unsat";
  correctedCages: Cage[];
  steps: KenKenSolveStep[];
}

/**
 * Client-side port of the real offline joint-cage correction loop (puzzlelab/
 * visual.py's kenken()): a bounded best-first search over real alternative
 * readings (from cageReadAlternatives) for the cages, trying single-cage swaps
 * (most confident first) before joint two-cage swaps if that's not enough. The
 * real pipeline prioritizes cages implicated by the solver's own unsat core;
 * this can't read Z3's unsat core (there's no Z3 here), so it searches every
 * unlocked cage's alternatives directly by confidence instead -- same real data,
 * same real bounded search, a simpler priority order.
 */
export function solveKenKenWithCorrectionLoop(size: number, cages: Cage[], topKByCageKey: Record<string, [number, number][][]>, maxAttempts = 20): KenKenCorrectionResult {
  function fullySatisfiable(cs: Cage[]): boolean {
    return solveKenKen(size, cs).status === "sat";
  }
  if (fullySatisfiable(cages)) return { engaged: false, status: "sat", correctedCages: cages, steps: [] };

  const originOf = (cage: Cage): [number, number] => cage.cells.reduce((m, c) => (c[0] < m[0] || (c[0] === m[0] && c[1] < m[1]) ? c : m));
  const steps: KenKenSolveStep[] = [];
  const [fr, fc] = originOf(cages[0]);
  steps.push({
    row: fr,
    col: fc,
    digit: 0,
    correction: { kind: "conflict-found" },
    reason: "the cages' current readings can't be solved together -- no assignment satisfies every row/column uniqueness and cage arithmetic constraint at once.",
  });

  type Choice = { cageIdx: number; op: Op; target: number; confidence: number };
  const choices: Choice[] = [];
  cages.forEach((cage, i) => {
    const topK = topKByCageKey[cageKey(cage)];
    if (!topK) return;
    for (const alt of cageReadAlternatives(topK, cage.cells.length)) {
      if (alt.op === cage.op && alt.target === cage.target) continue;
      choices.push({ cageIdx: i, op: alt.op, target: alt.target, confidence: alt.confidence });
    }
  });

  function apply(changes: Choice[]): Cage[] {
    const next = cages.map((c) => ({ ...c }));
    for (const ch of changes) next[ch.cageIdx] = { ...next[ch.cageIdx], op: ch.op, target: ch.target };
    return next;
  }

  let queue: { changes: Choice[]; cost: number }[] = choices.map((c) => ({ changes: [c], cost: 1 - c.confidence }));
  const visited = new Set<string>();
  let tries = 0;

  while (queue.length > 0 && tries < maxAttempts) {
    queue.sort((a, b) => a.cost - b.cost);
    const node = queue.shift()!;
    const key = node.changes.map((c) => `${c.cageIdx}:${c.op}:${c.target}`).sort().join("|");
    if (visited.has(key)) continue;
    visited.add(key);

    const candidate = apply(node.changes);
    tries++;
    const accepted = fullySatisfiable(candidate);
    for (const ch of node.changes) {
      const [r, c] = originOf(cages[ch.cageIdx]);
      steps.push({ row: r, col: c, digit: 0, correction: { kind: accepted ? "corrected" : "try", confidence: ch.confidence, op: ch.op, target: ch.target } });
    }
    if (accepted) return { engaged: true, status: "sat", correctedCages: candidate, steps };
    for (const ch of node.changes) {
      const [r, c] = originOf(cages[ch.cageIdx]);
      steps.push({ row: r, col: c, digit: 0, correction: { kind: "revert", confidence: ch.confidence, op: cages[ch.cageIdx].op, target: cages[ch.cageIdx].target } });
    }
    if (node.changes.length === 1) {
      for (const c of choices) {
        if (c.cageIdx === node.changes[0].cageIdx) continue;
        queue.push({ changes: [...node.changes, c], cost: node.cost + 2 - c.confidence });
      }
    }
  }

  const [gr, gc] = originOf(cages[0]);
  steps.push({
    row: gr,
    col: gc,
    digit: 0,
    correction: { kind: "give-up" },
    reason: `Tried ${tries} ranked-alternative combination(s) from the real CNN readings across the affected cages -- none resolve it within budget.`,
  });
  return { engaged: true, status: "unsat", correctedCages: cages, steps };
}
