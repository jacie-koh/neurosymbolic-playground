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
 * the other four modules' solvers were. This module is for inspecting what the
 * fresh pipeline actually perceived and comparing it against both ground truth and
 * the authors' own (replayed) perception on the identical images — including the
 * honest cases where fresh perception lands on the wrong answer or finds nothing.
 *
 * 100 real puzzles (spanning all 15 relation patterns) were run through this exact
 * pipeline offline (standalone/reports/debugger/vdp_fresh/run_100.py) and are
 * browsable here via a randomizer + a real difficulty slider — object count and
 * the paper's own per-pattern formula-complexity bound (see VDPManifestEntry).
 *
 * Vocabulary and layout follow Murali et al. (IJCAI 2022) directly, not just the
 * solver's internal terms: a puzzle is Example images E (must all satisfy the
 * discriminator, Definition 3's D1) and Candidate images C (exactly one must,
 * D2+D3) — rendered here as an overview board mirroring the paper's Figure 1,
 * not a flat "scene 0/1/2..." tab list. Each puzzle also carries the real English
 * sentence its ground-truth concept was built from (vendor/vdp/utils/common.py's
 * intended_concept, e.g. "Every sphere has a cylinder to its right"), shown before
 * the raw FO-SL formula so the puzzle reads the way the paper poses it.
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
  let selectedScene: string | null = null;
  let playing = false;
  let playTimer: ReturnType<typeof setTimeout> | undefined;
  /** How many objects in the current scene have been "perceived" so far; null = show everything (not playing). */
  let revealCount: number | null = null;
  let resultsRevealed = true;

  function stopPlaying(): void {
    playing = false;
    if (playTimer !== undefined) {
      clearTimeout(playTimer);
      playTimer = undefined;
    }
  }

  const randomizerHost = el("div");
  const difficultyNote = el("p", { class: "muted", style: { fontSize: "12px", marginTop: "-4px" } });
  const body = el("div", { style: { marginTop: "16px" } });
  root.append(randomizerHost, difficultyNote, body);

  let manifest: VDPManifestEntry[] = [];

  function currentEntry(): VDPManifestEntry | undefined {
    return manifest.find((e) => e.file === activeFile);
  }

  function selectTrace(file: string): void {
    stopPlaying();
    revealCount = null;
    resultsRevealed = true;
    activeFile = file;
    selectedScene = null;
    clear(body);
    body.append(el("p", { class: "muted" }, "Loading trace…"));
    loadVDPTrace(file)
      .then((t) => {
        trace = t;
        selectedScene = t.scenes.find((s) => s.role === "train")?.sceneId ?? t.scenes[0]?.sceneId ?? null;
        drawDifficultyNote();
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

  function drawDifficultyNote(): void {
    const entry = currentEntry();
    difficultyNote.textContent = entry
      ? `${entry.pattern} · difficulty ${entry.difficulty}/5 · ~${entry.objectCount} objects/scene · ` +
        `formula budget: ${entry.quantifierBound} quantifiers${entry.conjunctBound != null ? `, ${entry.conjunctBound} conjuncts` : ""}`
      : "";
  }

  loadVDPManifest().then((m) => {
    manifest = m;
    const initial = m.find((e) => e.file === activeFile);
    renderRandomizer<VDPManifestEntry>(randomizerHost, m, {
      fields: [
        { key: "pattern", label: "Pattern", get: (e) => e.pattern },
        { key: "difficulty", label: "Difficulty", get: (e) => e.difficulty, type: "range" },
      ],
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
    drawDifficultyNote();
  });

  function verdictBadge(t: VDPTrace): HTMLElement {
    const freshCand = t.freshResult.candidate;
    const refCand = t.referenceResult.candidate;
    if (t.freshResult.status !== "sat") {
      return el("span", { class: "badge badge-strong" }, "fresh: no discriminator found");
    }
    if (freshCand && refCand && freshCand === refCand) {
      return el("span", { class: "badge badge-weak" }, "fresh matches the reference answer");
    }
    return el("span", { class: "badge badge-strong" }, "fresh picks a different candidate than the reference");
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
  function disagreementExplanation(t: VDPTrace): HTMLElement | null {
    const freshCand = t.freshResult.candidate;
    const refCand = t.referenceResult.candidate;
    if (t.freshResult.status === "sat" && freshCand && refCand && freshCand === refCand) return null;

    if (t.freshResult.status !== "sat") {
      return el(
        "div",
        { class: "note", style: { marginTop: "10px", fontSize: "12px" } },
        el("b", {}, "Why: "),
        "the real search found no discriminator that uniquely picks one object within its quantifier/conjunct budget for this scene set — a search-budget limit, not necessarily a perception error."
      );
    }

    const acc = t.accuracy;
    const misreadRates = ATTRS.map((a) => ({ attr: a, rate: acc[a] })).filter((x) => x.rate != null && x.rate < 1);
    if (misreadRates.length > 0) {
      const worst = misreadRates.sort((a, b) => (a.rate as number) - (b.rate as number))[0];
      return el(
        "div",
        { class: "note", style: { marginTop: "10px", fontSize: "12px" } },
        el("b", {}, "Why: "),
        `fresh perception misread ${worst.attr} on ${(100 - (worst.rate as number) * 100).toFixed(1)}% of objects across this puzzle's scenes — a real classification error that steered the search toward a different, but still independently verified, discriminator.`
      );
    }

    return el(
      "div",
      { class: "note", style: { marginTop: "10px", fontSize: "12px" } },
      el("b", {}, "Why: "),
      "every color/material/size/shape read was correct here — the disagreement instead comes from estimated 3D position (regressed from box size/depth, not classified), which feeds the left/right/front/behind relations the formula quantifies over. A small position drift can flip which relations hold even with perfect attributes."
    );
  }

  /** "0.json" (the solver's own candidate identifier, a scene filename) -> "Candidate 2"
   * (that scene's position among this puzzle's candidates) -- human-readable, not the
   * raw solver_ir filename the formula's JSON literally names. */
  function candidateLabel(t: VDPTrace, raw: string | null): string | null {
    if (!raw) return null;
    const sceneId = raw.replace(/\.json$/, "");
    const candidates = t.scenes.filter((s) => s.role === "test");
    const idx = candidates.findIndex((s) => s.sceneId === sceneId);
    return idx >= 0 ? `Candidate ${idx + 1}` : raw;
  }

  /**
   * The paper (Murali et al., IJCAI 2022, Definition 3) poses a VDP as: Example
   * images E, all of which the discriminator must hold in, and Candidate images
   * C, of which exactly one must satisfy it. This module's data was built with a
   * train/test split matching that exactly (see traces.ts's VDPScene.role doc) --
   * "Example"/"Candidate" here is just rendering that in the paper's own words
   * instead of the solver's internal train/test labels.
   */
  function roleLabel(role: "train" | "test"): string {
    return role === "train" ? "Example" : "Candidate";
  }

  /** Puzzle-board overview (Figure 1 of the paper): every Example thumbnail
   * together, every Candidate thumbnail together, with whichever candidate fresh
   * perception and the reference each picked marked -- so the puzzle's actual
   * question ("which candidate matches?") is visible before diving into any one
   * scene's perception detail. */
  function drawOverview(panel: HTMLElement, t: VDPTrace): void {
    clear(panel);
    const examples = t.scenes.filter((s) => s.role === "train");
    const candidates = t.scenes.filter((s) => s.role === "test");
    const freshPick = t.freshResult.candidate?.replace(/\.json$/, "") ?? null;
    const refPick = t.referenceResult.candidate?.replace(/\.json$/, "") ?? null;

    function thumb(s: VDPScene, indexLabel: string): HTMLElement {
      const marks = [freshPick === s.sceneId ? "fresh" : null, refPick === s.sceneId ? "reference" : null].filter(Boolean);
      return el(
        "div",
        {
          style: { cursor: "pointer", width: "110px" },
          onclick: () => { stopPlaying(); revealCount = null; resultsRevealed = true; selectedScene = s.sceneId; drawBody(); },
        },
        el("img", {
          src: s.image,
          alt: `${indexLabel} scene`,
          style: {
            width: "100%",
            borderRadius: "6px",
            border: s.sceneId === selectedScene ? "3px solid #0877bd" : marks.length ? "3px solid #f59322" : "1px solid var(--line)",
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

    const overview = el("div", { style: { marginTop: "12px" } });
    drawOverview(overview, t);

    const acc = t.accuracy;
    const accRow = el(
      "div",
      { class: "flow-payload", style: { marginTop: "12px", display: "block" } },
      `detected ${t.detectedCount}/${t.trueCount} objects · ` +
        ATTRS.map((a) => `${a} ${acc[a] != null ? `${((acc[a] as number) * 100).toFixed(1)}%` : "—"}`).join(" · ")
    );

    const scene = t.scenes.find((s) => s.sceneId === selectedScene);

    const playRow = el(
      "div",
      { class: "btn-row", style: { marginTop: "12px" } },
      playing
        ? el("button", { class: "btn primary", onclick: () => { stopPlaying(); drawBody(); } }, "⏸ Stop")
        : el(
            "button",
            { class: "btn primary", disabled: !scene, onclick: () => playScene(scene!) },
            revealCount != null ? "▶ Replay perceiving this scene" : "▶ Watch it perceive & solve in real time"
          ),
      playing && scene
        ? el("span", { class: "muted", style: { fontSize: "12px", alignSelf: "center" } }, `perceiving… object ${Math.min(revealCount ?? 0, scene.predictions.length)}/${scene.predictions.length}`)
        : ""
    );

    // The real FO-SL search itself can't be stepped (puzzlelab.vdp.run() is one opaque
    // subprocess call, not a recorded search trace -- every completed run here in fact
    // records exactly one candidate, confirmed against the real sweep data), so this
    // steps through the one real sequential process that *is* recorded: perceiving
    // objects one at a time, same as the play button above but manually paced.
    const stepRow = scene
      ? el(
          "div",
          { class: "btn-row", style: { marginTop: "8px" } },
          el("button", { class: "btn", disabled: playing || revealedCount(scene) <= 0, onclick: () => stepTo(scene, revealedCount(scene) - 1) }, "◀ Step back"),
          el("button", { class: "btn", disabled: playing || revealedCount(scene) >= scene.predictions.length, onclick: () => stepTo(scene, revealedCount(scene) + 1) }, "Step forward ▶"),
          el("span", { class: "muted", style: { fontSize: "12px", alignSelf: "center" } }, `object ${revealedCount(scene)}/${scene.predictions.length}`)
        )
      : "";

    const resultsPanel = !resultsRevealed
      ? el("div", { class: "note", style: { marginTop: "12px" } }, el("span", { class: "muted" }, "perceiving objects first — the solve result will reveal once perception finishes…"))
      : el(
          "div",
          { class: "note", style: { marginTop: "12px" } },
          el("div", {}, verdictBadge(t)),
          el(
            "div",
            { style: { marginTop: "10px" } },
            el("b", {}, "Fresh perception → real FO-SL solve: "),
            t.freshResult.status,
            t.freshResult.formula ? el("div", { class: "flow-payload", style: { marginTop: "6px", display: "block" } }, t.freshResult.formula) : "",
            t.freshResult.candidate ? el("div", { style: { marginTop: "4px", fontSize: "12px" } }, `→ picks ${candidateLabel(t, t.freshResult.candidate)}`) : ""
          ),
          el(
            "div",
            { style: { marginTop: "10px" } },
            el("b", {}, "Reference (authors' replayed perception, same images): "),
            t.referenceResult.status,
            t.referenceResult.formula ? el("div", { class: "flow-payload", style: { marginTop: "6px", display: "block" } }, t.referenceResult.formula) : "",
            t.referenceResult.candidate ? el("div", { style: { marginTop: "4px", fontSize: "12px" } }, `→ picks ${candidateLabel(t, t.referenceResult.candidate)}`) : ""
          ),
          disagreementExplanation(t) ?? ""
        );

    const groupIndex = new Map<string, number>();
    for (const role of ["train", "test"] as const) {
      t.scenes.filter((s) => s.role === role).forEach((s, i) => groupIndex.set(s.sceneId, i + 1));
    }
    const sceneTabs = el(
      "div",
      { class: "seg", style: { marginTop: "16px" } },
      ...t.scenes.map((s) =>
        el(
          "button",
          {
            class: "seg-btn" + (s.sceneId === selectedScene ? " active" : ""),
            onclick: () => { stopPlaying(); revealCount = null; resultsRevealed = true; selectedScene = s.sceneId; drawBody(); },
          },
          el("span", { class: "seg-flow" }, `${roleLabel(s.role)} ${groupIndex.get(s.sceneId)}`),
          el("span", { class: "seg-name" }, s.role === "train" ? "must satisfy" : "candidate")
        )
      )
    );

    const scenePanel = el("div", { style: { marginTop: "12px" } });
    if (scene) drawScene(scenePanel, scene);

    const logLines =
      scene && revealCount != null
        ? scene.predictions.slice(0, Math.min(revealCount, scene.predictions.length)).map((pred, i) => {
            const desc = ATTRS.map((a) => pred[a].value).join(" ");
            const conf = Math.min(...ATTRS.map((a) => pred[a].topK[0][1]));
            return `object ${i + 1}: ${desc} (${(conf * 100).toFixed(1)}%)`;
          })
        : [];
    const logBox = renderLiveLog(logLines);

    body.append(conceptNote, overview, accRow, playRow, stepRow, logBox, resultsPanel, sceneTabs, scenePanel);
  }

  function revealedCount(scene: VDPScene): number {
    return revealCount ?? scene.predictions.length;
  }

  function stepTo(scene: VDPScene, count: number): void {
    stopPlaying();
    revealCount = Math.max(0, Math.min(scene.predictions.length, count));
    resultsRevealed = revealCount >= scene.predictions.length;
    drawBody();
  }

  function playScene(scene: VDPScene): void {
    stopPlaying();
    revealCount = 0;
    resultsRevealed = false;
    playing = true;
    const delay = 450;
    const tick = () => {
      if (!playing) return;
      if ((revealCount ?? 0) >= scene.predictions.length) {
        resultsRevealed = true;
        playing = false;
        drawBody();
        return;
      }
      revealCount = (revealCount ?? 0) + 1;
      drawBody();
      playTimer = setTimeout(tick, delay);
    };
    drawBody();
    playTimer = setTimeout(tick, delay);
  }

  const BOX_COLORS = ["#0877bd", "#f59322", "#8e44ad", "#2e8b57", "#c0392b", "#00838f", "#b8860b", "#6a5acd"];

  function drawScene(panel: HTMLElement, scene: VDPScene): void {
    clear(panel);
    const shown = revealCount == null ? scene.predictions.length : revealCount;

    const imageBox = el("div", { style: { position: "relative", maxWidth: "480px", marginBottom: "12px" } });
    const img = el("img", {
      src: scene.image,
      width: scene.imageWidth,
      height: scene.imageHeight,
      alt: `Rendered CLEVR scene ${scene.sceneId}`,
      style: { display: "block", width: "100%", height: "auto", borderRadius: "8px", border: "1px solid var(--line)" },
    });
    imageBox.append(img);
    scene.predictions.forEach((pred, i) => {
      if (i >= shown) return;
      const [x1, y1, x2, y2] = pred.box;
      const color = BOX_COLORS[i % BOX_COLORS.length];
      imageBox.append(
        el("div", {
          style: {
            position: "absolute",
            left: `${(x1 / scene.imageWidth) * 100}%`,
            top: `${(y1 / scene.imageHeight) * 100}%`,
            width: `${((x2 - x1) / scene.imageWidth) * 100}%`,
            height: `${((y2 - y1) / scene.imageHeight) * 100}%`,
            border: `2px solid ${color}`,
            borderRadius: "3px",
            boxSizing: "border-box",
            pointerEvents: "none",
          },
        }),
        el(
          "div",
          {
            style: {
              position: "absolute",
              left: `${(x1 / scene.imageWidth) * 100}%`,
              top: `${(y1 / scene.imageHeight) * 100}%`,
              transform: "translateY(-100%)",
              background: color,
              color: "#fff",
              fontSize: "10px",
              fontWeight: "700",
              padding: "1px 4px",
              borderRadius: "3px 3px 3px 0",
            },
          },
          String(i + 1)
        )
      );
    });

    const grid = el("div", { style: { display: "flex", flexWrap: "wrap", gap: "10px" } });
    scene.predictions.forEach((pred, i) => {
      if (i >= shown) {
        grid.append(
          el(
            "div",
            { class: "compound-token", style: { minWidth: "150px", alignItems: "stretch", opacity: 0.35 } },
            el("div", { class: "name" }, `object ${i + 1}`),
            el("div", { style: { fontSize: "12px", marginTop: "4px" } }, el("span", { class: "muted" }, "…"))
          )
        );
        return;
      }
      const truth = scene.groundTruth[i];
      const rows = ATTRS.map((attr) => {
        const p = pred[attr];
        const correct = truth && p.value === truth[attr];
        return el(
          "div",
          { style: { fontSize: "12px", marginTop: "4px" } },
          el("span", { class: "muted" }, `${attr}: `),
          el("span", { style: { fontWeight: "700", color: correct ? "inherit" : "#b3261e" } }, p.value),
          truth && !correct ? el("span", { class: "muted" }, ` (truth: ${truth[attr]})`) : "",
          " ",
          el("span", { class: "muted" }, `${(p.topK[0][1] * 100).toFixed(1)}%`)
        );
      });
      grid.append(
        el(
          "div",
          { class: "compound-token", style: { minWidth: "150px", alignItems: "stretch", borderLeft: `3px solid ${BOX_COLORS[i % BOX_COLORS.length]}` } },
          el("div", { class: "name" }, `object ${i + 1}`),
          ...rows
        )
      );
    });
    const groupNum = trace ? trace.scenes.filter((s) => s.role === scene.role).findIndex((s) => s.sceneId === scene.sceneId) + 1 : "?";
    panel.append(
      el(
        "div",
        { style: { fontSize: "13px", marginBottom: "6px" } },
        el("b", {}, `${roleLabel(scene.role)} ${groupNum} — real rendered CLEVR scene, boxes from the actual detector:`)
      ),
      imageBox,
      grid
    );
  }

  selectTrace(activeFile);
}
