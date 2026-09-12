import { mountDebuggerPage } from "./shell";
import { renderVDPDebugger } from "../views/vdpDebugger";

const root = mountDebuggerPage(
  "Visual Discrimination",
  "Real fresh perception (a detector + attribute CNN trained from scratch here, no CUDA needed) + the real, unmodified FO-SL synthesizer from the standalone research backend (standalone/), precomputed and browsable here."
);
renderVDPDebugger(root);
