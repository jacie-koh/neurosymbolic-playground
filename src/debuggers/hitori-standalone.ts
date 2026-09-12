import { mountDebuggerPage } from "./shell";
import { renderHitoriDebugger } from "../views/hitoriDebugger";
import { store } from "../state";

// This standalone page has no stacking-pattern switcher of its own, so default
// to Symbolic → Neural — the only pattern where the real local-LLM explanation step runs.
store.set({ pattern: "reasoning-for-learning" });

const root = mountDebuggerPage(
  "Hitori",
  "Real Z3 forced-move proofs + local-model explanation from the standalone research backend (standalone/), precomputed and browsable here."
);
renderHitoriDebugger(root);
