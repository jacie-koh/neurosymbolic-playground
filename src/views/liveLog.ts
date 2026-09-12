/** Small scrolling log box showing each step of a live solve/perceive animation, auto-scrolled to the latest line. */

import { el } from "../dom";

export function renderLiveLog(lines: string[]): HTMLElement | "" {
  if (lines.length === 0) return "";
  const box = el(
    "div",
    {
      style: {
        marginTop: "8px",
        maxHeight: "120px",
        overflowY: "auto",
        fontFamily: "monospace",
        fontSize: "11px",
        lineHeight: "1.5",
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: "6px",
        padding: "6px 8px",
      },
    },
    ...lines.map((line) => el("div", {}, line))
  );
  queueMicrotask(() => {
    box.scrollTop = box.scrollHeight;
  });
  return box;
}
