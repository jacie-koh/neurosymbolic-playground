/**
 * Shared shell for standalone Interactive Reasoning Debugger pages.
 *
 * These are deliberately separate from the main playground app (src/main.ts):
 * each puzzle module gets its own <module>.html + <module>-standalone.ts entry
 * so it can be opened and reviewed on its own, before any decision is made
 * about how (or whether) it gets folded into the main playground flow.
 */
import "../style.css";
import { el, clear } from "../dom";

export function mountDebuggerPage(title: string, tagline: string): HTMLElement {
  document.title = `${title} · Reasoning Debugger`;
  const app = document.querySelector<HTMLDivElement>("#app")!;
  clear(app);

  app.append(
    el(
      "header",
      { class: "topbar" },
      el("img", { src: "/logo-mark.png", alt: "", class: "brand-mark" }),
      el("h1", {}, `${title}: Reasoning Debugger`),
      el("div", { class: "spacer" }),
      el(
        "a",
        { href: "/debuggers/index.html", class: "btn", style: { textDecoration: "none" } },
        "All debuggers"
      )
    )
  );

  const main = el(
    "main",
    { class: "view" },
    el("div", { class: "view-head" }, el("p", {}, tagline))
  );
  app.append(main);
  return main;
}
