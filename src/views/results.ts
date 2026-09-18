/**
 * Step 2: results. Real measured stats (via realResults.ts) plus the real
 * interactive debugger for whichever of the five paper-backed modules is
 * selected — every situation in the picker maps to exactly one of these.
 */

import { store } from "../state";
import { el, clear } from "../dom";
import { renderSudokuDebugger } from "./sudokuDebugger";
import { renderZebraDebugger } from "./zebraDebugger";
import { renderKenKenDebugger } from "./kenkenDebugger";
import { renderHitoriDebugger } from "./hitoriDebugger";
import { renderVDPDebugger } from "./vdpDebugger";
import { renderRealResults } from "./realResults";

const DEBUGGER_RENDERERS: Record<string, (root: HTMLElement) => void> = {
  sudoku: renderSudokuDebugger,
  "zebra-puzzle": renderZebraDebugger,
  kenken: renderKenKenDebugger,
  hitori: renderHitoriDebugger,
  "visual-discrimination": renderVDPDebugger,
};

export function renderResults(root: HTMLElement): void {
  clear(root);

  const st = store.get();
  const debuggerRenderer = st.situationId ? DEBUGGER_RENDERERS[st.situationId] : undefined;
  if (!debuggerRenderer || !st.situationId) {
    root.append(
      el("p", { class: "note" }, "Pick a puzzle first."),
      el(
        "div",
        { class: "btn-row", style: { marginTop: "16px" } },
        el("button", { class: "btn", onclick: () => store.set({ view: "situations" }) }, "← New puzzle")
      )
    );
    return;
  }

  renderRealResults(root, st.situationId, () => renderResults(root));

  const debuggerHost = el("div", { style: { marginTop: "16px" } });
  root.append(debuggerHost);
  debuggerRenderer(debuggerHost);

  root.append(
    el(
      "div",
      { class: "btn-row", style: { marginTop: "16px" } },
      el("button", { class: "btn", onclick: () => store.set({ view: "situations" }) }, "← New puzzle")
    )
  );
}
