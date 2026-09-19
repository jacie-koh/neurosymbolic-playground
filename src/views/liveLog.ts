/** Small scrolling log box showing each step of a live solve/perceive animation, auto-scrolled to the latest line. */

import { el } from "../dom";

/** The box is recreated from scratch on every render (every step, every auto-play
 * tick), so a plain per-element size would snap back the instant the user
 * finishes dragging the native resize handle -- these persist the user's chosen
 * size (and the observer watching for drag-resize) across those re-renders.
 * width defaults to a fixed pixel value rather than "100%" of its container --
 * that container's own natural width can shift slightly from one render to the
 * next (e.g. a step counter like "12/58" growing to "99/1143050" changes how
 * much horizontal space sibling buttons take up), which made this box visibly
 * change width on every single tick/step even though nothing about the log
 * itself changed. A fixed width means it only ever changes size when the user
 * actually drags the resize handle. */
let savedWidth: string | null = null;
let savedHeight: string | null = null;
let lastObserver: ResizeObserver | null = null;

export function renderLiveLog(lines: string[]): HTMLElement {
  // Always rendered, even with nothing to show yet -- returning "" (no element)
  // for an empty log meant its ~120px footprint would pop into existence the
  // instant the first line arrived (right after pressing Start), shoving every
  // element below it down the page. Reserving that space from the start, with a
  // placeholder message, keeps the page from jumping when playback begins.
  const lineEls: HTMLElement[] =
    lines.length === 0
      ? [el("div", { class: "muted" }, "Press ▶ Start to watch the pipeline run live, or use Step forward to step manually.")]
      : // wordBreak + a fixed width above are what actually stop a long unwrapped
        // line (e.g. a Z3 "also legal" explanation) from ballooning this box's
        // *intrinsic* content width past its container -- a CSS grid/flex "auto"
        // track sizes to an item's max-content width, which for wrappable text is
        // computed as if it were laid out on one line, not the width it visually
        // wraps to. Without an explicit width here the log box (and every
        // ancestor up to the grid/flex container) would balloon to fit the
        // longest line.
        lines.map((line) => el("div", { style: { overflowWrap: "anywhere", wordBreak: "break-word" } }, line));
  const box = el(
    "div",
    {
      style: {
        marginTop: "8px",
        width: savedWidth ?? "460px",
        maxWidth: "100%", // never lets a wider saved/dragged width overflow a narrower container
        boxSizing: "border-box",
        height: savedHeight ?? "120px",
        minHeight: "60px",
        minWidth: "0",
        overflow: "auto",
        resize: "both",
        fontFamily: "monospace",
        fontSize: "11px",
        lineHeight: "1.5",
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: "6px",
        padding: "6px 8px",
      },
    },
    ...lineEls
  );
  lastObserver?.disconnect();
  lastObserver = new ResizeObserver(() => {
    // offsetWidth/offsetHeight (border+padding+content) match what the CSS
    // width/height above actually mean under box-sizing: border-box. Using
    // clientHeight here (which excludes the 1px+1px border) fed back a value 2px
    // too small every time -- and since that value becomes next render's
    // `height`, each of the many re-renders during auto-play or Step
    // forward/back shaved another 2px off, visibly shrinking the box (and
    // shifting everything below it up the page) a little more on every step.
    savedWidth = `${box.offsetWidth}px`;
    savedHeight = `${box.offsetHeight}px`;
  });
  lastObserver.observe(box);
  queueMicrotask(() => {
    box.scrollTop = box.scrollHeight;
  });
  return box;
}
