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

/** Every (group, entity) pair not yet assigned a house. */
function unassignedEntities(ir: ZebraIR, positions: Record<string, number>): { group: string; entity: string }[] {
  const out: { group: string; entity: string }[] = [];
  for (const [group, entities] of Object.entries(ir.groups)) {
    for (const entity of entities) if (positions[entity] == null) out.push({ group, entity });
  }
  return out;
}

export function solveZebra(ir: ZebraIR): ZebraSolveResult {
  const positions: Record<string, number> = {};
  const usedByGroup: Record<string, Set<number>> = {};
  for (const group of Object.keys(ir.groups)) usedByGroup[group] = new Set();
  const totalEntities = Object.values(ir.groups).reduce((n, es) => n + es.length, 0);
  if (totalEntities === 0) return { status: "unsat", solution: null };

  function decidableViolated(): boolean {
    return ir.clues.some((clue) => {
      const known = [clue.a, clue.b].filter(Boolean).every((e) => positions[e as string] != null);
      return known && !satisfies(clue, positions);
    });
  }

  function candidatesFor(group: string, entity: string): number[] {
    const out: number[] = [];
    for (let house = 1; house <= ir.size; house++) {
      if (usedByGroup[group].has(house)) continue;
      positions[entity] = house;
      const ok = !decidableViolated();
      delete positions[entity];
      if (ok) out.push(house);
    }
    return out;
  }

  // Most-constrained-entity-first: a fixed group-then-entity order can blow up
  // catastrophically on 6-house+ puzzles (millions of trial placements observed) —
  // always picking whichever unassigned entity has the fewest legal houses left
  // (given every already-decidable clue) keeps this fast at real puzzle sizes.
  function pickNext(): { group: string; entity: string; candidates: number[] } | null {
    let best: { group: string; entity: string; candidates: number[] } | null = null;
    for (const { group, entity } of unassignedEntities(ir, positions)) {
      const candidates = candidatesFor(group, entity);
      if (!best || candidates.length < best.candidates.length) {
        best = { group, entity, candidates };
        if (candidates.length <= 1) return best;
      }
    }
    return best;
  }

  function backtrack(remaining: number): boolean {
    if (remaining === 0) return true;
    const picked = pickNext();
    if (!picked) return false;
    const { group, entity, candidates } = picked;
    for (const house of candidates) {
      positions[entity] = house;
      usedByGroup[group].add(house);
      if (backtrack(remaining - 1)) return true;
      usedByGroup[group].delete(house);
      delete positions[entity];
    }
    return false;
  }

  const ok = backtrack(totalEntities);
  return ok ? { status: "sat", solution: { ...positions } } : { status: "unsat", solution: null };
}

/** One mutation of the backtracking search: house>0 is a trial placement, house===0
 * undoes it. deadEnd steps (house===0, deadEnd: true) are the actual dead-end moment
 * -- this entity has no legal house left at all, given the current trial assignment
 * -- as opposed to a plain undo, which just means a deeper entity dead-ended and
 * this trial is being abandoned to try the next candidate house. */
export interface ZebraSolveStep {
  entity: string;
  house: number;
  deadEnd?: boolean;
  reason?: string;
}

export interface ZebraSolveTrace extends ZebraSolveResult {
  steps: ZebraSolveStep[];
}

/** Same most-constrained-entity-first search as solveZebra, but records every trial
 * placement and undo for animated playback. A fixed group-then-entity order (the
 * original version of this function) can generate millions of steps on a 6-house+
 * puzzle — measured 25.8M on one real puzzle, which would hang the animation for
 * hours — so this uses the same MRV ordering solveZebra() does. */
export function solveZebraWithSteps(ir: ZebraIR): ZebraSolveTrace {
  const positions: Record<string, number> = {};
  const usedByGroup: Record<string, Set<number>> = {};
  for (const group of Object.keys(ir.groups)) usedByGroup[group] = new Set();
  const totalEntities = Object.values(ir.groups).reduce((n, es) => n + es.length, 0);
  const steps: ZebraSolveStep[] = [];
  if (totalEntities === 0) return { status: "unsat", solution: null, steps };

  function decidableViolated(): boolean {
    return ir.clues.some((clue) => {
      const known = [clue.a, clue.b].filter(Boolean).every((e) => positions[e as string] != null);
      return known && !satisfies(clue, positions);
    });
  }

  function candidatesFor(group: string, entity: string): number[] {
    const out: number[] = [];
    for (let house = 1; house <= ir.size; house++) {
      if (usedByGroup[group].has(house)) continue;
      positions[entity] = house;
      const ok = !decidableViolated();
      delete positions[entity];
      if (ok) out.push(house);
    }
    return out;
  }

  function pickNext(): { group: string; entity: string; candidates: number[] } | null {
    let best: { group: string; entity: string; candidates: number[] } | null = null;
    for (const { group, entity } of unassignedEntities(ir, positions)) {
      const candidates = candidatesFor(group, entity);
      if (!best || candidates.length < best.candidates.length) {
        best = { group, entity, candidates };
        if (candidates.length <= 1) return best;
      }
    }
    return best;
  }

  /** Names one real, specific clue blocking this entity -- tries its first free
   * house and reports the clue that rules it out (every other free house fails a
   * clue too, or there'd be a candidate), rather than a generic "no houses" message. */
  function explainDeadEnd(group: string, entity: string): string {
    const freeHouses: number[] = [];
    for (let house = 1; house <= ir.size; house++) if (!usedByGroup[group].has(house)) freeHouses.push(house);
    if (freeHouses.length === 0) return "every house in this category is already assigned to another entity";
    const house = freeHouses[0];
    positions[entity] = house;
    const violated = ir.clues.find((clue) => {
      const known = [clue.a, clue.b].filter(Boolean).every((e) => positions[e as string] != null);
      return known && !satisfies(clue, positions);
    });
    delete positions[entity];
    if (!violated) return `house ${house} and every other free house still fail some combination of clues`;
    const clueDesc = violated.b ? `${violated.relation}(${violated.a}, ${violated.b})` : `${violated.relation}(${violated.a})`;
    return `placing it at house ${house} would violate clue "${clueDesc}" — every other free house fails a clue too`;
  }

  function backtrack(remaining: number): boolean {
    if (remaining === 0) return true;
    const picked = pickNext();
    if (!picked) return false;
    const { group, entity, candidates } = picked;
    if (candidates.length === 0) {
      steps.push({ entity, house: 0, deadEnd: true, reason: explainDeadEnd(group, entity) });
      return false;
    }
    for (const house of candidates) {
      positions[entity] = house;
      usedByGroup[group].add(house);
      steps.push({ entity, house });
      if (backtrack(remaining - 1)) return true;
      usedByGroup[group].delete(house);
      delete positions[entity];
      steps.push({ entity, house: 0 });
    }
    return false;
  }

  const ok = backtrack(totalEntities);
  return { status: ok ? "sat" : "unsat", solution: ok ? { ...positions } : null, steps };
}
