/** Dark/light theme toggle. The actual repaint is just CSS custom properties
 * reacting to a `data-theme` attribute on <html> -- nothing here ever needs
 * to trigger an app re-render. */

import { el } from "./dom";

export type Theme = "dark" | "light";

const STORAGE_KEY = "theme";

export function getTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // localStorage unavailable (private mode, etc.) -- fall back to dark.
  }
  return "dark";
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Nothing to persist to -- the toggle still works for this page load.
  }
}

// Applied at import time (before the app's first render) so the saved theme
// paints immediately instead of flashing dark-then-light on every load.
applyTheme(getTheme());

const SUN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
  '<circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2.5M12 19v2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M2.5 12h2.5M19 12h2.5M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8"/>' +
  "</svg>";
const MOON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>' +
  "</svg>";

/** A small icon button that flips the whole app between dark/light. Shows the
 * icon for the theme a click would switch *to* (sun while dark, moon while
 * light), matching the usual light/dark toggle convention. */
export function themeToggleButton(extraClass = ""): HTMLElement {
  const btn = el("button", {
    class: `theme-toggle ${extraClass}`.trim(),
    type: "button",
    "aria-label": "Toggle light/dark theme",
  });
  function paint(): void {
    const theme = getTheme();
    btn.innerHTML = theme === "dark" ? SUN : MOON;
    btn.title = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  }
  btn.addEventListener("click", () => {
    applyTheme(getTheme() === "dark" ? "light" : "dark");
    paint();
  });
  paint();
  return btn;
}
