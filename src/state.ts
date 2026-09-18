/**
 * Global application state + a tiny observable store.
 *
 * The whole app is a single page that swaps between three "views":
 *   landing -> situations -> results
 */

export type ViewName = "landing" | "situations" | "results";

/** The three symbolic engines the user can choose for the symbolic block. */
export type SymbolicMethod = "kg" | "rules" | "forward-chaining";

/**
 * The three ways neural + symbolic can be stacked. These map directly onto the
 * taxonomy in Yu et al. "A Survey on Neural-symbolic Learning Systems".
 */
export type StackingPattern =
  | "learning-for-reasoning" // Neural -> Symbolic (serial; neural feeds the reasoner)
  | "reasoning-for-learning" // Symbolic -> Neural (symbolic knowledge constrains learning)
  | "learning-reasoning"; // Neural <-> Symbolic (tight, end-to-end loop)

export type ActivationName = "tanh" | "relu" | "sigmoid" | "linear";
export type RegularizationName = "none" | "l1" | "l2";

export interface NeuralConfig {
  /** Hidden-layer sizes only (input/output are derived from the situation). */
  hiddenLayers: number[];
  activation: ActivationName;
  learningRate: number;
  regularization: RegularizationName;
  regularizationRate: number;
  /** Which input features are switched on (TF-Playground style). */
  features: string[];
  batchSize: number;
  /** Dataset noise level, 0..0.5 (TF Playground's noise slider / 100). */
  noise: number;
  /** Fraction of data used for training, 0..1 (TF Playground's % train data / 100). */
  trainRatio: number;
}

export interface SymbolicConfig {
  method: SymbolicMethod;
  /** Confidence threshold above which a neural reading is "trusted" as a fact. */
  threshold: number;
}

export interface AppState {
  view: ViewName;
  situationId: string | null;
  pattern: StackingPattern | null;
  neural: NeuralConfig;
  symbolic: SymbolicConfig;
}

function defaultState(): AppState {
  return {
    view: "landing",
    situationId: null,
    pattern: "learning-for-reasoning",
    neural: {
      hiddenLayers: [4, 2],
      activation: "tanh",
      learningRate: 0.03,
      regularization: "none",
      regularizationRate: 0,
      features: ["x1", "x2"],
      batchSize: 10,
      noise: 0,
      trainRatio: 0.6,
    },
    symbolic: {
      method: "rules",
      threshold: 0.5,
    },
  };
}

type Listener = (state: AppState) => void;

class Store {
  private state: AppState = defaultState();
  private listeners = new Set<Listener>();

  get(): AppState {
    return this.state;
  }

  /** Shallow-merge a patch into the state and notify subscribers. */
  set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  /** Update a nested config slice without clobbering the rest of it. */
  setNeural(patch: Partial<NeuralConfig>): void {
    this.state = { ...this.state, neural: { ...this.state.neural, ...patch } };
    this.emit();
  }

  setSymbolic(patch: Partial<SymbolicConfig>): void {
    this.state = {
      ...this.state,
      symbolic: { ...this.state.symbolic, ...patch },
    };
    this.emit();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.state);
  }
}

export const store = new Store();

