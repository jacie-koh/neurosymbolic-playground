import { mountDebuggerPage } from "./shell";
import { renderSudokuDebugger } from "../views/sudokuDebugger";
import { store } from "../state";

// This standalone page has no stacking-pattern switcher of its own, so default
// to the real bounded correction loop (Neural ↔ Symbolic) — the full pipeline.
store.set({ pattern: "learning-reasoning" });

const root = mountDebuggerPage(
  "Sudoku",
  "Real CNN readings + Z3 solving from the standalone research backend (standalone/), precomputed and browsable here."
);
renderSudokuDebugger(root);
