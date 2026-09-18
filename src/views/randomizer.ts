/** Shared filter + randomize control for debuggers with a large (~100) real example pool. */

import { el, clear } from "../dom";

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

  /** Matches every field's current selection except `exceptKey`, so a field's own
   * option list can be computed against what the *other* filters already narrowed
   * it to (e.g. legibility only ever has real values for handwritten puzzles -- once
   * style=printed is picked, legibility has none, and the field disappears rather
   * than offering choices that would always return zero results). */
  function matchesExcept(entry: T, exceptKey?: string): boolean {
    return opts.fields.every((f) => {
      if (f.key === exceptKey) return true;
      const want = selected[f.key];
      if (!want) return true;
      const v = f.get(entry);
      return v != null && String(v) === want;
    });
  }

  function optionsFor(f: FilterField<T>): (string | number)[] {
    const seen = new Set<string | number>();
    for (const entry of manifest) {
      if (!matchesExcept(entry, f.key)) continue;
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

  const row = el("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", marginTop: "16px", marginBottom: "10px" } });
  root.append(row);

  function render(): void {
    clear(row);
    for (const f of opts.fields) {
      const options = optionsFor(f);
      // Nothing this field could be set to would leave any results, given the
      // other filters currently chosen -- don't offer a control that can only
      // ever produce an empty pool.
      if (options.length === 0) {
        selected[f.key] = "";
        continue;
      }
      if (selected[f.key] && !options.some((v) => String(v) === selected[f.key])) {
        selected[f.key] = "";
      }
      row.append(
        el(
          "select",
          {
            style: {
              fontSize: "13px",
              padding: "8px 10px",
              borderRadius: "8px",
              border: "1px solid var(--line-strong)",
              background: "#fff",
              color: "var(--ink)",
            },
            onchange: (e: Event) => {
              selected[f.key] = (e.target as HTMLSelectElement).value;
              render();
            },
          },
          el("option", { value: "" }, `Any ${f.label.toLowerCase()}`),
          ...options.map((v) => el("option", { value: String(v), selected: String(v) === selected[f.key] }, `${f.label}: ${v}`))
        )
      );
    }
    row.append(
      el(
        "button",
        {
          class: "btn primary",
          onclick: () => {
            const pool = manifest.filter((e) => matchesExcept(e));
            opts.onPick(pool.length === 0 ? null : pool[Math.floor(Math.random() * pool.length)]);
          },
        },
        "Randomize"
      )
    );
  }

  render();
}
