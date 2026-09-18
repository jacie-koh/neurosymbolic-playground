/**
 * Interactive Reasoning Debugger — Visual Discrimination Puzzles (VDP) module.
 *
 * Unlike the other four modules, this one runs genuinely fresh neural perception:
 * a Faster R-CNN detector + a per-crop attribute CNN, both trained from scratch on
 * local CLEVR renders (never the authors' checkpoints, which require an old
 * Ubuntu/CUDA stack this machine can't run), feeding the authors' own deterministic
 * relation logic and the real, unmodified FO-SL symbolic synthesizer. See
 * standalone/reports/debugger/vdp_fresh/ for the full pipeline.
 *
 * There's no live "rerun" here: full FO-SL synthesis is a real search over
 * first-order formulas, not something worth reimplementing in the browser the way
 * the other four modules' solvers were. Pressing Run replays the real perception,
 * the real derived relations, and the real solve result already computed offline
 * — narrated in order, not a fresh computation — including the honest cases where
 * fresh perception lands on the wrong answer or finds nothing.
 *
 * 100 real puzzles (spanning all 15 relation patterns) were run through this exact
 * pipeline offline (standalone/reports/debugger/vdp_fresh/run_100.py) and are
 * browsable here via a randomizer filtered by relation pattern (see VDPManifestEntry).
 *
 * Vocabulary and layout follow Murali et al. (IJCAI 2022) directly, not just the
 * solver's internal terms: a puzzle is Example images E (must all satisfy the
 * discriminator, Definition 3's D1) and Candidate images C (exactly one must,
 * D2+D3) — rendered as an overview board mirroring the paper's Figure 1, with
 * which candidate was picked revealed only after pressing Run, not shown upfront.
 * Each puzzle also carries the real English sentence its ground-truth concept was
 * built from (vendor/vdp/utils/common.py's intended_concept, e.g. "Every sphere
 * has a cylinder to its right"), shown before the raw FO-SL formula so the puzzle
 * reads the way the paper poses it.
 */

import { el, clear } from "../dom";
import { loadVDPTrace, loadVDPManifest, type VDPTrace, type VDPScene, type VDPManifestEntry } from "../data/traces";
import { renderLiveLog } from "./liveLog";
import { renderRandomizer } from "./randomizer";

const ATTRS = ["color", "material", "size", "shape"] as const;

export function renderVDPDebugger(root: HTMLElement): void {
  clear(root);

  let activeFile = "vdp-match.json";
  let trace: VDPTrace | null = null;
  let running = false;
  let runLines: string[] = [];
  /** The full narration for the current trace, computed once by buildRunSteps() and
   * then just replayed -- lets Step back/forward jump anywhere without recomputing. */
  let runSteps: string[] = [];
  let runIdx = 0;
  /** Line counts at which the fresh/reference result becomes known -- the overview
   * board's "picked by" marks reveal independently once runIdx reaches each, exactly
   * where the log actually says so, not all at once. */
  let freshRevealAt = 0;
  let refRevealAt = 0;
  let runTimer: ReturnType<typeof setTimeout> | undefined;
  /** Persistent containers filled in by drawBody(), so the auto-play tick (every
   * 180ms) can refresh just the log/controls -- and the image-heavy overview board
   * only on the rare tick that actually reveals a new pick -- instead of tearing
   * down and rebuilding the whole page every tick. Recreating <img> elements that
   * often (each with no reserved height) was both why Stop couldn't reliably keep
   * up with clicks and why the page visibly jumped as images reflowed in and out. */
  let overviewHost: HTMLElement | null = null;

  function stopRunning(): void {
    running = false;
    if (runTimer !== undefined) {
      clearTimeout(runTimer);
      runTimer = undefined;
    }
  }

  // Run/Step/output stay in one fixed block at the top of the page -- appended
  // once, never torn down as a whole -- so they're always in the same place
  // regardless of how tall the puzzle content below happens to be, and so
  // pressing Run/Stop never shifts the page around them.
  const controlsHost = el("div");
  const randomizerHost = el("div");
  const patternNote = el("p", { class: "muted", style: { fontSize: "12px", marginTop: "-4px" } });
  const body = el("div", { style: { marginTop: "16px" } });
  root.append(controlsHost, randomizerHost, patternNote, body);

  let manifest: VDPManifestEntry[] = [];

  function currentEntry(): VDPManifestEntry | undefined {
    return manifest.find((e) => e.file === activeFile);
  }

  function selectTrace(file: string): void {
    stopRunning();
    runLines = [];
    runSteps = [];
    runIdx = 0;
    freshRevealAt = 0;
    refRevealAt = 0;
    activeFile = file;
    clear(body);
    body.append(el("p", { class: "muted" }, "Loading trace…"));
    loadVDPTrace(file)
      .then((t) => {
        trace = t;
        drawPatternNote();
        drawBody();
      })
      .catch(() => {
        clear(body);
        body.append(
          el("p", { class: "note" }, "Couldn't load this trace — the dev server may still be starting up."),
          el("button", { class: "btn", onclick: () => selectTrace(file) }, "Retry")
        );
      });
  }

  function drawPatternNote(): void {
    const entry = currentEntry();
    patternNote.textContent = entry
      ? `${entry.pattern} · ~${entry.objectCount} objects/scene · ` +
        `formula budget: ${entry.quantifierBound} quantifiers${entry.conjunctBound != null ? `, ${entry.conjunctBound} conjuncts` : ""}`
      : "";
  }

  loadVDPManifest().then((m) => {
    manifest = m;
    const initial = m.find((e) => e.file === activeFile);
    renderRandomizer<VDPManifestEntry>(randomizerHost, m, {
      fields: [{ key: "pattern", label: "Pattern", get: (e) => e.pattern }],
      initial,
      onPick: (entry) => {
        if (!entry) {
          clear(body);
          body.append(el("p", { class: "note" }, "No real examples match that combination — try loosening a filter."));
          return;
        }
        selectTrace(entry.file);
      },
    });
    drawPatternNote();
  });

  /** "0.json" (the solver's own candidate identifier, a scene filename) -> "Candidate 2"
   * (that scene's position among this puzzle's candidates) -- human-readable, not the
   * raw solver_ir filename the formula's JSON literally names. */
  function candidateLabel(t: VDPTrace, raw: string | null): string {
    if (!raw) return "nothing";
    const sceneId = raw.replace(/\.json$/, "");
    const candidates = t.scenes.filter((s) => s.role === "test");
    const idx = candidates.findIndex((s) => s.sceneId === sceneId);
    return idx >= 0 ? `Candidate ${idx + 1}` : raw;
  }

  /**
   * There's no retry/correction loop for this module (unlike Sudoku's Z3 correction
   * loop or Zebra's conflict-retry) -- puzzlelab.vdp.run() is a single subprocess
   * call, real search, no second attempt. So when fresh disagrees with the
   * reference, this explains *why* from the trace's own real numbers instead of
   * pretending something got "fixed":
   *   - low per-attribute accuracy -> a real misclassification steered the search
   *     toward a different (but still individually verified) discriminator.
   *   - 100% attribute accuracy -> every color/material/size/shape read correctly,
   *     so the disagreement traces to the *derived* left/right/front/behind
   *     relations instead: those come from a depth-regressed 3D position
   *     estimate, not a classifier output, and a small position drift can flip
   *     which relations hold even when every attribute is right.
   */
  function disagreementReason(t: VDPTrace): string | null {
    const freshCand = t.freshResult.candidate;
    const refCand = t.referenceResult.candidate;
    if (t.freshResult.status === "sat" && freshCand && refCand && freshCand === refCand) return null;

    if (t.freshResult.status !== "sat") {
      return "Why: the real search found no discriminator that uniquely picks one candidate within its quantifier/conjunct budget — a search-budget limit, not necessarily a perception error.";
    }

    const acc = t.accuracy;
    const misreadRates = ATTRS.map((a) => ({ attr: a, rate: acc[a] })).filter((x) => x.rate != null && x.rate < 1);
    if (misreadRates.length > 0) {
      const worst = misreadRates.sort((a, b) => (a.rate as number) - (b.rate as number))[0];
      return (
        `Why: fresh perception misread ${worst.attr} on ${(100 - (worst.rate as number) * 100).toFixed(1)}% of objects across this puzzle's scenes` +
        " — a real classification error that steered the search toward a different, but still independently verified, discriminator."
      );
    }

    return (
      "Why: every color/material/size/shape read was correct here — the disagreement instead comes from estimated 3D position " +
      "(regressed from box size/depth, not classified), which feeds the left/right/front/behind relations the formula quantifies over. " +
      "A small position drift can flip which relations hold even with perfect attributes."
    );
  }

  function objectSummary(scene: VDPScene): string {
    return scene.predictions.map((p) => `${p.shape.value}(${p.color.value},${p.material.value},${p.size.value})`).join(", ");
  }

  /** Condenses this scene's real relations (the actual FO-SL input the solver reasoned
   * over) into a few readable lines: drops the inverse of an already-shown directional
   * relation (right is just left reversed, front is just behind reversed) and "disequal"
   * (almost always true for distinct shapes, rarely informative), and de-duplicates
   * symmetric same_X pairs. Caps how many pairs are printed per relation so a
   * many-object scene doesn't flood the log -- the count of anything hidden is shown. */
  function relationLines(scene: VDPScene): string[] {
    const SYMMETRIC = new Set(["same_color", "same_material", "same_size"]);
    const SKIP = new Set(["disequal", "right", "front"]);
    const lines: string[] = [];
    for (const rel of scene.relations) {
      if (SKIP.has(rel.name)) continue;
      let pairs = rel.pairs;
      if (SYMMETRIC.has(rel.name)) {
        const seen = new Set<string>();
        pairs = pairs.filter(([a, b]) => {
          const key = a < b ? `${a},${b}` : `${b},${a}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
      if (pairs.length === 0) continue;
      const shown = pairs.slice(0, 6).map(([a, b]) => `${rel.name}(${a},${b})`).join(", ");
      const extra = pairs.length > 6 ? ` +${pairs.length - 6} more` : "";
      lines.push(`    ${shown}${extra}`);
    }
    return lines;
  }

  /** Builds the full narration once per trace: every line Run will reveal, in
   * order, plus the line-counts at which the fresh/reference results become known
   * (so Step back/forward can jump anywhere without recomputing, and the overview
   * board can reveal each pick exactly where the log actually says so). */
  function buildRunSteps(t: VDPTrace): { lines: string[]; freshAt: number; refAt: number } {
    const examples = t.scenes.filter((s) => s.role === "train");
    const candidates = t.scenes.filter((s) => s.role === "test");
    const entry = currentEntry();
    const groups: string[][] = [];

    examples.forEach((s, i) => groups.push([`Example ${i + 1}: ${s.predictions.length} objects detected — ${objectSummary(s)}`]));
    candidates.forEach((s, i) => groups.push([`Candidate ${i + 1}: ${s.predictions.length} objects detected — ${objectSummary(s)}`]));

    groups.push(["Deriving the relations the solver reasons over (left/behind, same_color/material/size):"]);
    [...examples, ...candidates].forEach((s, i) => {
      const label = i < examples.length ? `Example ${i + 1}` : `Candidate ${i - examples.length + 1}`;
      const lines = relationLines(s);
      if (lines.length > 0) groups.push([`  ${label}:`, ...lines]);
    });

    groups.push([
      `Searching for a discriminator: guarded FO-SL, ≤${entry?.quantifierBound ?? "?"} quantifiers` +
        `${entry?.conjunctBound != null ? `, ≤${entry.conjunctBound} conjuncts` : ""} (real Z3 SAT search)…`,
    ]);

    const freshLines = [
      t.freshResult.status === "sat" && t.freshResult.formula
        ? `Fresh perception → found: ${t.freshResult.formula}`
        : `Fresh perception → ${t.freshResult.status}: no discriminator found within budget`,
    ];
    if (t.freshResult.status === "sat") {
      freshLines.push(`  → holds in all ${examples.length} examples, and in exactly ${candidateLabel(t, t.freshResult.candidate)} among the candidates.`);
    }
    groups.push(freshLines);
    const freshAt = groups.reduce((n, g) => n + g.length, 0);

    const refLines = [
      t.referenceResult.status === "sat" && t.referenceResult.formula
        ? `Reference (authors' replayed perception, same images) → found: ${t.referenceResult.formula}`
        : `Reference → ${t.referenceResult.status}: no discriminator found`,
    ];
    if (t.referenceResult.status === "sat") refLines.push(`  → picks ${candidateLabel(t, t.referenceResult.candidate)}.`);
    groups.push(refLines);
    const refAt = groups.reduce((n, g) => n + g.length, 0);

    const freshCand = t.freshResult.candidate;
    const refCand = t.referenceResult.candidate;
    const matches = t.freshResult.status === "sat" && freshCand != null && freshCand === refCand;
    const verdictLines = [matches ? "fresh matches the reference answer." : "fresh disagrees with the reference answer."];
    const reason = disagreementReason(t);
    if (reason) verdictLines.push(reason);
    groups.push(verdictLines);

    return { lines: groups.flat(), freshAt, refAt };
  }

  function ensureRunSteps(t: VDPTrace): void {
    if (runSteps.length > 0) return;
    const built = buildRunSteps(t);
    runSteps = built.lines;
    freshRevealAt = built.freshAt;
    refRevealAt = built.refAt;
  }

  function stepRunTo(t: VDPTrace, idx: number): void {
    stopRunning();
    ensureRunSteps(t);
    const prevIdx = runIdx;
    runIdx = Math.max(0, Math.min(runSteps.length, idx));
    runLines = runSteps.slice(0, runIdx);
    // Cheap every click: just text and a couple of buttons, no images -- mirrors
    // runFrom's tick. Calling the full drawBody() here (as before) rebuilt every
    // thumbnail <img> in the overview on every single Step click, which is what was
    // making the page visibly jump.
    drawControls(controlsHost, t);
    const crossedFresh = (prevIdx < freshRevealAt) !== (runIdx < freshRevealAt);
    const crossedRef = (prevIdx < refRevealAt) !== (runIdx < refRevealAt);
    if ((crossedFresh || crossedRef) && overviewHost) drawOverview(overviewHost, t);
  }

  function runFrom(t: VDPTrace): void {
    stopRunning();
    const built = buildRunSteps(t);
    runSteps = built.lines;
    freshRevealAt = built.freshAt;
    refRevealAt = built.refAt;
    runIdx = 0;
    runLines = [];
    running = true;
    const tick = () => {
      if (!running) return;
      if (runIdx >= runSteps.length) {
        running = false;
        drawControls(controlsHost, t);
        return;
      }
      const prevIdx = runIdx;
      runIdx++;
      runLines = runSteps.slice(0, runIdx);
      // Cheap every tick: just text and a couple of buttons, no images.
      drawControls(controlsHost, t);
      // Expensive, so only when a pick actually just became known: the overview's
      // thumbnails (real <img> elements) get rebuilt.
      const justRevealed = (prevIdx < freshRevealAt && runIdx >= freshRevealAt) || (prevIdx < refRevealAt && runIdx >= refRevealAt);
      if (justRevealed && overviewHost) drawOverview(overviewHost, t);
      runTimer = setTimeout(tick, 180);
    };
    drawBody();
    runTimer = setTimeout(tick, 180);
  }

  /** Puzzle-board overview (Figure 1 of the paper): every Example thumbnail together,
   * every Candidate thumbnail together. Which candidate fresh perception and the
   * reference each picked is marked only once Run has actually revealed that result
   * -- not upfront, so the board poses the same question a human solver would face. */
  function drawOverview(panel: HTMLElement, t: VDPTrace): void {
    clear(panel);
    const examples = t.scenes.filter((s) => s.role === "train");
    const candidates = t.scenes.filter((s) => s.role === "test");
    const freshPick = runIdx >= freshRevealAt && freshRevealAt > 0 ? t.freshResult.candidate?.replace(/\.json$/, "") ?? null : null;
    const refPick = runIdx >= refRevealAt && refRevealAt > 0 ? t.referenceResult.candidate?.replace(/\.json$/, "") ?? null : null;

    function thumb(s: VDPScene, indexLabel: string): HTMLElement {
      const marks = [freshPick === s.sceneId ? "fresh" : null, refPick === s.sceneId ? "reference" : null].filter(Boolean);
      return el(
        "div",
        { style: { width: "110px" } },
        el("img", {
          src: s.image,
          alt: `${indexLabel} scene`,
          style: {
            width: "100%",
            borderRadius: "6px",
            border: marks.length ? "3px solid #f59322" : "1px solid var(--line)",
            display: "block",
          },
        }),
        el("div", { style: { fontSize: "11px", marginTop: "3px", textAlign: "center" } }, indexLabel),
        marks.length ? el("div", { style: { fontSize: "10px", textAlign: "center", color: "#f59322" } }, `picked by ${marks.join(" & ")}`) : ""
      );
    }

    panel.append(
      el("div", { style: { fontSize: "12px", marginBottom: "4px" } }, el("b", {}, "Examples "), el("span", { class: "muted" }, "— the discriminator must hold in all of these")),
      el("div", { style: { display: "flex", gap: "10px", marginBottom: "12px" } }, ...examples.map((s, i) => thumb(s, `Example ${i + 1}`))),
      el("div", { style: { fontSize: "12px", marginBottom: "4px" } }, el("b", {}, "Candidates "), el("span", { class: "muted" }, "— exactly one should satisfy it")),
      el("div", { style: { display: "flex", gap: "10px" } }, ...candidates.map((s, i) => thumb(s, `Candidate ${i + 1}`)))
    );
  }

  /** Just the Run/Stop button, the Step back/forward row, and the log -- all cheap
   * (text + buttons, no images) -- so the auto-play tick can refresh this alone. */
  function drawControls(host: HTMLElement, t: VDPTrace): void {
    clear(host);
    const runRow = el(
      "div",
      { class: "btn-row" },
      running
        ? el("button", { class: "btn primary", onclick: () => { stopRunning(); drawControls(controlsHost, t); } }, "⏸ Stop")
        : el("button", { class: "btn primary", onclick: () => runFrom(t) }, runIdx > 0 ? "▶ Replay" : "▶ Run"),
      running ? el("span", { class: "muted", style: { fontSize: "12px", alignSelf: "center" } }, `running… line ${runIdx}/${runSteps.length}`) : ""
    );

    const stepRow = el(
      "div",
      { class: "btn-row", style: { marginTop: "8px" } },
      el("button", { class: "btn", disabled: running || runIdx <= 0, onclick: () => stepRunTo(t, runIdx - 1) }, "◀ Step back"),
      el("button", { class: "btn", disabled: running || (runSteps.length > 0 && runIdx >= runSteps.length), onclick: () => stepRunTo(t, runIdx + 1) }, "Step forward ▶"),
      runSteps.length > 0 ? el("span", { class: "muted", style: { fontSize: "12px", alignSelf: "center" } }, `line ${runIdx}/${runSteps.length}`) : ""
    );

    const logBox = renderLiveLog(runLines);
    host.append(runRow, stepRow, logBox);
  }

  function drawBody(): void {
    if (!trace) return;
    const t = trace;
    clear(body);

    const conceptNote = el(
      "div",
      { class: "note", style: { marginTop: "10px" } },
      el("b", {}, "Intended concept (ground truth, from the paper's own puzzle generator): "),
      `"${t.intendedConcept}"`
    );

    overviewHost = el("div", { style: { marginTop: "12px" } });
    drawOverview(overviewHost, t);

    const acc = t.accuracy;
    // detectedCount can genuinely exceed trueCount: it's the detector's raw box
    // count across all 6 scenes, not a "correct out of total" fraction, and this
    // detector's NMS occasionally lets two overlapping boxes for the same object
    // both through (confirmed by inspecting the actual box coordinates on affected
    // puzzles -- nested/near-identical boxes, not two real distinct objects).
    const extra = t.detectedCount - t.trueCount;
    const detectionSummary =
      extra > 0
        ? `${t.detectedCount} boxes detected across ${t.scenes.length} scenes — ${extra} more than the ${t.trueCount} real objects (near-duplicate boxes for the same object slipping past NMS)`
        : `${t.detectedCount} boxes detected across ${t.scenes.length} scenes, matching the ${t.trueCount} real objects`;
    const accRow = el(
      "div",
      { class: "flow-payload", style: { marginTop: "12px", display: "block" } },
      `${detectionSummary} · ` + ATTRS.map((a) => `${a} ${acc[a] != null ? `${((acc[a] as number) * 100).toFixed(1)}%` : "—"}`).join(" · ")
    );

    drawControls(controlsHost, t);

    body.append(conceptNote, overviewHost, accRow);
  }

  selectTrace(activeFile);
}
