import { mountDebuggerPage } from "./shell";
import { renderZebraDebugger } from "../views/zebraDebugger";

const root = mountDebuggerPage(
  "Zebra / Einstein",
  "Real local-LLM clue translation + Colored Exact Cover / MINIEXACT solving from the standalone research backend (standalone/), precomputed and browsable here."
);
renderZebraDebugger(root);
