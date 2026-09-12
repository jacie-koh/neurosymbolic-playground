/**
 * Loads curated JSON traces produced by the standalone/ research backend
 * (real pretrained CNNs + Z3, run offline — see standalone/README.md) as
 * static assets for the Interactive Reasoning Debugger.
 *
 * The deployed playground is a static site with no server, so these traces
 * are precomputed and checked in under public/traces/<puzzle>/*.json rather
 * than being produced by a live backend call. See standalone/reports/debugger/
 * for the trimming script that produced them from full pipeline runs.
 */

export interface CellPrediction {
  value: number;
  confidence: number;
  /** [digit, probability][], highest first — the CNN's alternative readings. */
  topK: [number, number][];
}

export interface SudokuCorrection {
  row: number;
  col: number;
  before: number;
  after: number;
  score: number;
}

export interface SudokuTrace {
  id: string;
  title: string;
  size: number;
  style: "printed" | "handwritten";
  image: string;
  /** Static path to the real photographed/rendered puzzle image the CNN actually read. */
  imageUrl: string;
  checkpoint: string;
  /** Raw CNN reading, 0 = blank cell. */
  recognized: number[][];
  /** After the offline correction loop, 0 = blank cell. */
  interpreted: number[][];
  /** Keyed "row,col" for every recognized (non-blank) cell. */
  predictions: Record<string, CellPrediction>;
  corrections: SudokuCorrection[];
  correctionAttempts: number;
  /** Low-confidence givens whose ranked alternative also solves, with a different
   * solution -- surfaced without ever consulting the answer key. Only ever
   * populated when result.status is "sat": the bounded correction above only runs
   * on an unsat baseline, so a misread that happens to still be satisfiable (a
   * classic Sudoku symmetric-swap ambiguity) is invisible to it by construction.
   * A puzzle with result.unique === false can also produce entries here that
   * reflect the puzzle's own multiple solutions rather than a specific misread. */
  ambiguousGivens: {
    row: number;
    col: number;
    given: number;
    confidence: number;
    alternative: number;
    alternativeConfidence: number | null;
  }[];
  result: {
    status: "sat" | "unsat";
    solution: number[][] | null;
    unique: boolean | null;
    conflicts: unknown[];
  };
  verification: string;
}

export const SUDOKU_TRACE_MANIFEST: { id: string; file: string }[] = [
  { id: "sudoku-9x9-correction", file: "sudoku-9x9-correction.json" },
  { id: "sudoku-16x16-ambiguous", file: "sudoku-16x16-ambiguous.json" },
  { id: "sudoku-9x9-clean", file: "sudoku-9x9-clean.json" },
  { id: "sudoku-9x9-printed", file: "sudoku-9x9-printed.json" },
  { id: "sudoku-4x4-printed", file: "sudoku-4x4-printed.json" },
];

const cache = new Map<string, Promise<unknown>>();

function loadTrace<T>(puzzle: string, file: string): Promise<T> {
  const key = `${puzzle}/${file}`;
  let p = cache.get(key) as Promise<T> | undefined;
  if (!p) {
    p = fetch(`/traces/${key}`).then((r) => {
      if (!r.ok) throw new Error(`Failed to load trace ${key}: ${r.status}`);
      return r.json() as Promise<T>;
    });
    // A failed fetch (dev-server hiccup, transient network error) must not
    // poison the cache forever — evict it so the next selection retries.
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

export function loadSudokuTrace(file: string): Promise<SudokuTrace> {
  return loadTrace<SudokuTrace>("sudoku", file);
}

export interface ZebraClueRecord {
  source: string;
  relation:
    | "at"
    | "not_at"
    | "same"
    | "next_to"
    | "left"
    | "immediately_left"
    | "right"
    | "immediately_right"
    | "distance";
  a: string;
  b?: string;
  position?: number;
  distance?: number;
}

export interface ZebraTrace {
  id: string;
  title: string;
  size: number;
  /** category id -> its "category@value" entity ids, e.g. g0 -> [g0@arnold, g0@eric]. */
  groups: Record<string, string[]>;
  clues: ZebraClueRecord[];
  result: {
    status: "sat" | "unsat" | "unknown";
    solution: Record<string, number> | null;
    unique: boolean | null;
  };
  verification: string;
}

export const ZEBRA_TRACE_MANIFEST: { id: string; file: string }[] = [
  { id: "zebra-2house-intro", file: "zebra-2house-intro.json" },
  { id: "zebra-3house", file: "zebra-3house.json" },
  { id: "zebra-4house", file: "zebra-4house.json" },
  { id: "zebra-4house-full", file: "zebra-4house-full.json" },
];

export function loadZebraTrace(file: string): Promise<ZebraTrace> {
  return loadTrace<ZebraTrace>("zebra", file);
}

export type KenKenOp = "add" | "sub" | "mul" | "div" | "";

export interface KenKenCage {
  cells: [number, number][];
  op: KenKenOp;
  target: number;
}

export interface KenKenCagePrediction {
  cage: [number, number][];
  /** Raw CNN character-class reads, in order (digits <10, operators 10=+ 11=÷ 12=× 13=-). */
  reads: number[];
  /** [class, probability][][] — ranked alternatives per read position. */
  topK: [number, number][][];
}

export interface KenKenCorrection {
  cage: number;
  before: KenKenCage;
  after: KenKenCage;
}

export interface KenKenTrace {
  id: string;
  title: string;
  size: number;
  style: "printed" | "handwritten";
  image: string;
  /** Static path to the real photographed/rendered puzzle image the CNN actually read. */
  imageUrl: string;
  checkpoint: string;
  recognized: KenKenCage[];
  interpreted: KenKenCage[];
  predictions: KenKenCagePrediction[];
  corrections: KenKenCorrection[];
  correctionAttempts: number;
  result: {
    status: "sat" | "unsat" | "invalid_interpretation";
    solution: number[][] | null;
    unique: boolean | null;
    conflicts: unknown[];
  };
  verification: string;
}

export const KENKEN_TRACE_MANIFEST: { id: string; file: string; style: "printed" | "handwritten" }[] = [
  { id: "kenken-3x3-clean", file: "kenken-3x3-clean.json", style: "printed" },
  { id: "kenken-4x4-clean", file: "kenken-4x4-clean.json", style: "printed" },
  { id: "kenken-4x4-correction", file: "kenken-4x4-correction.json", style: "handwritten" },
  { id: "kenken-6x6-handwritten", file: "kenken-6x6-handwritten.json", style: "handwritten" },
];

export function loadKenKenTrace(file: string): Promise<KenKenTrace> {
  return loadTrace<KenKenTrace>("kenken", file);
}

export interface HitoriDeduction {
  row: number;
  col: number;
  shaded: boolean;
  kind: "local" | "connectivity";
  evidence: string[];
}

export interface HitoriTrace {
  id: string;
  title: string;
  grid: number[][];
  source: string;
  status: "sat" | "unsat";
  solution: boolean[][] | null;
  unique: boolean | null;
  deductions: HitoriDeduction[];
  explanation?: string;
  explanationStatus?: string;
}

export const HITORI_TRACE_MANIFEST: { id: string; file: string }[] = [
  { id: "hitori-p63", file: "hitori-p63.json" },
  { id: "hitori-ppbench-6x6", file: "hitori-ppbench-6x6.json" },
  { id: "hitori-ppbench-8x8", file: "hitori-ppbench-8x8.json" },
  { id: "hitori-ppbench-11x10", file: "hitori-ppbench-11x10.json" },
];

export function loadHitoriTrace(file: string): Promise<HitoriTrace> {
  return loadTrace<HitoriTrace>("hitori", file);
}

export type VDPAttribute = "color" | "material" | "size" | "shape";

export interface VDPAttrPrediction {
  value: string;
  topK: [string, number][];
}

export interface VDPObjectPrediction {
  /** [x1, y1, x2, y2] pixel box in the scene image, from the real Faster R-CNN detector. */
  box: [number, number, number, number];
  color: VDPAttrPrediction;
  material: VDPAttrPrediction;
  size: VDPAttrPrediction;
  shape: VDPAttrPrediction;
}

export interface VDPGroundTruth {
  color: string;
  material: string;
  size: string;
  shape: string;
}

export interface VDPScene {
  sceneId: string;
  role: "train" | "test";
  /** Static path to the real rendered CLEVR scene image this scene's predictions came from. */
  image: string;
  imageWidth: number;
  imageHeight: number;
  predictions: VDPObjectPrediction[];
  groundTruth: VDPGroundTruth[];
}

export interface VDPSynthesisResult {
  status: string | null;
  formula: string | null;
  candidate: string | null;
}

export interface VDPTrace {
  id: string;
  title: string;
  scenes: VDPScene[];
  accuracy: { color: number | null; material: number | null; size: number | null; shape: number | null };
  detectedCount: number;
  trueCount: number;
  freshResult: VDPSynthesisResult;
  referenceResult: VDPSynthesisResult;
}

export const VDP_TRACE_MANIFEST: { id: string; file: string }[] = [
  { id: "vdp-match", file: "vdp-match.json" },
  { id: "vdp-match-2", file: "vdp-match-2.json" },
  { id: "vdp-wrong-candidate", file: "vdp-wrong-candidate.json" },
];

export function loadVDPTrace(file: string): Promise<VDPTrace> {
  return loadTrace<VDPTrace>("vdp", file);
}
