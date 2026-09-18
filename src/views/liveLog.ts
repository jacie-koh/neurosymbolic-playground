/** Small scrolling log box showing each step of a live solve/perceive animation, auto-scrolled to the latest line. */

import { el } from "../dom";

/** The box is recreated from scratch on every render (every step, every auto-play
 * tick), so a plain per-element height would snap back the instant the user
 * finishes dragging the native resize handle -- these persist the user's chosen
 * height (and the observer watching for drag-resize) across those re-renders. */
let savedHeight: string | null = null;
let lastObserver: ResizeObserver | null = null;

export function renderLiveLog(lines: string[]): HTMLElement | "" {
  if (lines.length === 0) return "";
  const box = el(
    "div",
    {
      style: {
        marginTop: "8px",
        height: savedHeight ?? "120px",
        minHeight: "60px",
        overflow: "auto",
        resize: "vertical",
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
  lastObserver?.disconnect();
  lastObserver = new ResizeObserver(() => {
    savedHeight = `${box.clientHeight}px`;
  });
  lastObserver.observe(box);
  queueMicrotask(() => {
    box.scrollTop = box.scrollHeight;
  });
  return box;
}
