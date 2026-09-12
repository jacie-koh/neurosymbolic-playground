/**
 * Size-generic Hitori rule checking + backtracking solve, for the trace
 * debugger. Mirrors the semantics of the standalone backend's
 * puzzlelab/hitori.py (validate() + the opposite-value forced-move test),
 * but is a plain backtracking search here, not the offline Z3 encoding —
 * so it can't extract a minimal unsat core the way Z3 does; it can only
 * say whether a cell's value is forced, not cite the minimal evidence.
 */

export type ShadeGrid = boolean[][];

export interface Violations {
  duplicates: { row: number; col: number }[];
  adjacentShaded: { row: number; col: number }[];
  disconnected: boolean;
}

/** Rule-check a (possibly partial, unshaded-by-default) grid — mirrors hitori.py's validate(). */
export function checkViolations(grid: number[][], shaded: ShadeGrid): Violations {
  const h = grid.length;
  const w = grid[0].length;
  const duplicates: { row: number; col: number }[] = [];

  for (let r = 0; r < h; r++) {
    const seen = new Map<number, number>();
    for (let c = 0; c < w; c++) {
      if (shaded[r][c]) continue;
      const v = grid[r][c];
      if (seen.has(v)) {
        duplicates.push({ row: r, col: c });
        duplicates.push({ row: r, col: seen.get(v)! });
      } else seen.set(v, c);
    }
  }
  for (let c = 0; c < w; c++) {
    const seen = new Map<number, number>();
    for (let r = 0; r < h; r++) {
      if (shaded[r][c]) continue;
      const v = grid[r][c];
      if (seen.has(v)) {
        duplicates.push({ row: r, col: c });
        duplicates.push({ row: seen.get(v)!, col: c });
      } else seen.set(v, r);
    }
  }

  const adjacentShaded: { row: number; col: number }[] = [];
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (!shaded[r][c]) continue;
      if (r + 1 < h && shaded[r + 1][c]) {
        adjacentShaded.push({ row: r, col: c }, { row: r + 1, col: c });
      }
      if (c + 1 < w && shaded[r][c + 1]) {
        adjacentShaded.push({ row: r, col: c }, { row: r, col: c + 1 });
      }
    }
  }

  const white: [number, number][] = [];
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (!shaded[r][c]) white.push([r, c]);
  let disconnected = false;
  if (white.length > 0) {
    const seen = new Set<string>();
    const queue: [number, number][] = [white[0]];
    while (queue.length) {
      const [r, c] = queue.shift()!;
      const key = `${r},${c}`;
      if (seen.has(key)) continue;
      seen.add(key);
      for (const [nr, nc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]] as [number, number][]) {
        if (nr < 0 || nc < 0 || nr >= h || nc >= w || shaded[nr][nc]) continue;
        if (!seen.has(`${nr},${nc}`)) queue.push([nr, nc]);
      }
    }
    disconnected = seen.size !== white.length;
  }

  return { duplicates, adjacentShaded, disconnected };
}

export interface HitoriSolveResult {
  status: "sat" | "unsat";
  solution: ShadeGrid | null;
}

/** Backtracking solve honoring fixed cell overrides (like hitori.py's `state`). */
export function solveHitori(grid: number[][], fixed: Map<string, boolean> = new Map()): HitoriSolveResult {
  const h = grid.length;
  const w = grid[0].length;
  const shaded: ShadeGrid = Array.from({ length: h }, () => Array(w).fill(false));

  function localOk(row: number, col: number): boolean {
    // Adjacent-shaded check against already-decided neighbors.
    if (shaded[row][col]) {
      for (const [nr, nc] of [[row - 1, col], [row, col - 1]] as [number, number][]) {
        if (nr >= 0 && nc >= 0 && shaded[nr][nc]) return false;
      }
    }
    return true;
  }

  function rowColOkSoFar(row: number, col: number): boolean {
    if (shaded[row][col]) return true;
    const v = grid[row][col];
    for (let c = 0; c < col; c++) if (!shaded[row][c] && grid[row][c] === v) return false;
    for (let r = 0; r < row; r++) if (!shaded[r][col] && grid[r][col] === v) return false;
    return true;
  }

  function connectivityOk(): boolean {
    return !checkViolations(grid, shaded).disconnected;
  }

  function backtrack(idx: number): boolean {
    if (idx === h * w) return connectivityOk();
    const row = Math.floor(idx / w);
    const col = idx % w;
    const key = `${row},${col}`;
    const choices = fixed.has(key) ? [fixed.get(key)!] : [false, true];
    for (const choice of choices) {
      shaded[row][col] = choice;
      if (localOk(row, col) && rowColOkSoFar(row, col) && backtrack(idx + 1)) return true;
    }
    shaded[row][col] = false;
    return false;
  }

  const ok = backtrack(0);
  return ok ? { status: "sat", solution: shaded.map((row) => [...row]) } : { status: "unsat", solution: null };
}

/** Is this cell's value forced (every valid completion agrees), given the current fixed cells? */
export function isForced(grid: number[][], fixed: Map<string, boolean>, row: number, col: number): boolean {
  const key = `${row},${col}`;
  const base = solveHitori(grid, fixed);
  if (base.status !== "sat" || !base.solution) return false;
  const opposite = new Map(fixed);
  opposite.set(key, !base.solution[row][col]);
  return solveHitori(grid, opposite).status === "unsat";
}
