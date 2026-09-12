/**
 * Generic Zebra / Einstein logic-grid solving: assign every entity in every
 * category group to a distinct house (1..size) satisfying a list of typed
 * clues. Mirrors the relation vocabulary and semantics of the standalone
 * backend's puzzlelab/zebra.py (check_assignment), but is a plain client-side
 * backtracking search here, not the authors' Colored Exact Cover / MINIEXACT
 * encoding. Small enough (<=12 houses per category) to solve instantly.
 */

export type Relation =
  | "at"
  | "not_at"
  | "same"
  | "next_to"
  | "left"
  | "immediately_left"
  | "right"
  | "immediately_right"
  | "distance";

export interface ZebraClue {
  source: string;
  relation: Relation;
  a: string;
  b?: string;
  position?: number;
  distance?: number;
}

export interface ZebraIR {
  size: number;
  groups: Record<string, string[]>;
  clues: ZebraClue[];
}

function satisfies(clue: ZebraClue, positions: Record<string, number>): boolean {
  const a = positions[clue.a];
  const b = clue.b != null ? positions[clue.b] : undefined;
  switch (clue.relation) {
    case "at":
      return a === clue.position;
    case "not_at":
      return a !== clue.position;
    case "same":
      return a === b;
    case "next_to":
      return Math.abs(a - (b as number)) === 1;
    case "left":
      return a < (b as number);
    case "immediately_left":
      return a + 1 === b;
    case "right":
      return a > (b as number);
    case "immediately_right":
      return a === (b as number) + 1;
    case "distance":
      return Math.abs(a - (b as number)) === clue.distance;
  }
}

/** Which clues are already decidable/violated given a partial assignment. */
export function evaluateClues(
  ir: ZebraIR,
  positions: Record<string, number>
): { clue: ZebraClue; status: "satisfied" | "violated" | "pending" }[] {
  return ir.clues.map((clue) => {
    const known = [clue.a, clue.b].filter(Boolean).every((e) => positions[e as string] != null);
    if (!known) return { clue, status: "pending" as const };
    return { clue, status: satisfies(clue, positions) ? ("satisfied" as const) : ("violated" as const) };
  });
}

export interface ZebraSolveResult {
  status: "sat" | "unsat";
  solution: Record<string, number> | null;
}

export function solveZebra(ir: ZebraIR): ZebraSolveResult {
  const positions: Record<string, number> = {};
  const entityQueue: { group: string; entity: string }[] = [];
  for (const [group, entities] of Object.entries(ir.groups)) {
    for (const entity of entities) entityQueue.push({ group, entity });
  }
  if (entityQueue.length === 0) return { status: "unsat", solution: null };

  const usedByGroup: Record<string, Set<number>> = {};
  for (const group of Object.keys(ir.groups)) usedByGroup[group] = new Set();

  function decidableViolated(): boolean {
    return ir.clues.some((clue) => {
      const known = [clue.a, clue.b].filter(Boolean).every((e) => positions[e as string] != null);
      return known && !satisfies(clue, positions);
    });
  }

  // Incremental backtracking, one entity at a time, pruning against every
  // clue that's fully decidable so far — scales far better than generating
  // whole-group permutations up front once puzzles reach 5 houses.
  function backtrack(idx: number): boolean {
    if (idx === entityQueue.length) return !decidableViolated();
    const { group, entity } = entityQueue[idx];
    for (let house = 1; house <= ir.size; house++) {
      if (usedByGroup[group].has(house)) continue;
      positions[entity] = house;
      usedByGroup[group].add(house);
      if (!decidableViolated() && backtrack(idx + 1)) return true;
      usedByGroup[group].delete(house);
      delete positions[entity];
    }
    return false;
  }

  const ok = backtrack(0);
  return ok ? { status: "sat", solution: { ...positions } } : { status: "unsat", solution: null };
}

/** One mutation of the backtracking search: house>0 is a trial placement, house===0 undoes it. */
export interface ZebraSolveStep {
  entity: string;
  house: number;
}

export interface ZebraSolveTrace extends ZebraSolveResult {
  steps: ZebraSolveStep[];
}

/** Same search as solveZebra, but records every trial placement and undo for animated playback. */
export function solveZebraWithSteps(ir: ZebraIR): ZebraSolveTrace {
  const positions: Record<string, number> = {};
  const entityQueue: { group: string; entity: string }[] = [];
  for (const [group, entities] of Object.entries(ir.groups)) {
    for (const entity of entities) entityQueue.push({ group, entity });
  }
  if (entityQueue.length === 0) return { status: "unsat", solution: null, steps: [] };

  const usedByGroup: Record<string, Set<number>> = {};
  for (const group of Object.keys(ir.groups)) usedByGroup[group] = new Set();
  const steps: ZebraSolveStep[] = [];

  function decidableViolated(): boolean {
    return ir.clues.some((clue) => {
      const known = [clue.a, clue.b].filter(Boolean).every((e) => positions[e as string] != null);
      return known && !satisfies(clue, positions);
    });
  }

  function backtrack(idx: number): boolean {
    if (idx === entityQueue.length) return !decidableViolated();
    const { group, entity } = entityQueue[idx];
    for (let house = 1; house <= ir.size; house++) {
      if (usedByGroup[group].has(house)) continue;
      positions[entity] = house;
      usedByGroup[group].add(house);
      steps.push({ entity, house });
      if (!decidableViolated() && backtrack(idx + 1)) return true;
      usedByGroup[group].delete(house);
      delete positions[entity];
      steps.push({ entity, house: 0 });
    }
    return false;
  }

  const ok = backtrack(0);
  return { status: ok ? "sat" : "unsat", solution: ok ? { ...positions } : null, steps };
}
