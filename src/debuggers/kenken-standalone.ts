import { mountDebuggerPage } from "./shell";
import { renderKenKenDebugger } from "../views/kenkenDebugger";
import { store } from "../state";

// This standalone page has no stacking-pattern switcher of its own, so default
// to the real bounded correction loop (Neural ↔ Symbolic) — the full pipeline.
store.set({ pattern: "learning-reasoning" });

const root = mountDebuggerPage(
  "KenKen",
  "Real CV cage detection + CNN target/operator reading + Z3 solving from the standalone research backend (standalone/), precomputed and browsable here."
);
renderKenKenDebugger(root);
