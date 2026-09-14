/** Shared filter + randomize control for debuggers with a large (~100) real example pool. */

import { el } from "../dom";

export interface FilterField<T> {
  key: string;
  label: string;
  /** Extracts this field's value from a manifest entry ("" entries are dropped from the option list). */
  get: (entry: T) => string | number | null | undefined;
  /** Preferred option order; anything not listed is appended, sorted. */
  order?: (string | number)[];
}

export interface RandomizerOptions<T> {
  fields: FilterField<T>[];
  /** Called with a randomly chosen entry matching the current filters (or null if none match). */
  onPick: (entry: T | null) => void;
  /** Called for the initially selected entry (e.g. the first curated example) so the UI matches the current state. */
  initial?: T;
}

export function renderRandomizer<T extends { id: string }>(
  root: HTMLElement,
  manifest: T[],
  opts: RandomizerOptions<T>
): void {
  const selected: Record<string, string> = {};
  for (const f of opts.fields) {
    const v = opts.initial ? f.get(opts.initial) : null;
    selected[f.key] = v != null ? String(v) : "";
  }

  function matches(entry: T): boolean {
    return opts.fields.every((f) => {
      const want = selected[f.key];
      if (!want) return true;
      const v = f.get(entry);
      return v != null && String(v) === want;
    });
  }

  function optionsFor(f: FilterField<T>): (string | number)[] {
    const seen = new Set<string | number>();
    for (const entry of manifest) {
      const v = f.get(entry);
      if (v != null && v !== "") seen.add(v);
    }
    const all = [...seen];
    if (f.order) {
      all.sort((a, b) => {
        const ia = f.order!.indexOf(a);
        const ib = f.order!.indexOf(b);
        if (ia === -1 && ib === -1) return String(a).localeCompare(String(b));
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
      });
    } else {
      all.sort((a, b) => (typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b))));
    }
    return all;
  }

  const selects = opts.fields.map((f) => {
    const select = el(
      "select",
      {
        style: { fontSize: "12px", padding: "4px 8px" },
        onchange: (e: Event) => {
          selected[f.key] = (e.target as HTMLSelectElement).value;
        },
      },
      el("option", { value: "" }, `Any ${f.label.toLowerCase()}`),
      ...optionsFor(f).map((v) => el("option", { value: String(v), selected: String(v) === selected[f.key] }, `${f.label}: ${v}`))
    );
    return select;
  });

  const randomizeBtn = el(
    "button",
    {
      class: "btn primary",
      onclick: () => {
        const pool = manifest.filter(matches);
        if (pool.length === 0) {
          opts.onPick(null);
          return;
        }
        const pick = pool[Math.floor(Math.random() * pool.length)];
        opts.onPick(pick);
      },
    },
    "🎲 Randomize"
  );

  root.append(
    el(
      "div",
      { style: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", marginBottom: "10px" } },
      ...selects,
      randomizeBtn
    )
  );
}
