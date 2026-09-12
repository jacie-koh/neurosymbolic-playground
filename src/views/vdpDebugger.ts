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
 */

import { el, clear } from "../dom";
import { VDP_TRACE_MANIFEST, loadVDPTrace, type VDPTrace, type VDPScene } from "../data/traces";
import { renderLiveLog } from "./liveLog";

const ATTRS = ["color", "material", "size", "shape"] as const;

export function renderVDPDebugger(root: HTMLElement): void {
  clear(root);

  let activeFile = VDP_TRACE_MANIFEST[0].file;
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

  const picker = el("div", { class: "seg" });
  const body = el("div", { style: { marginTop: "16px" } });
  root.append(picker, body);

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
        drawPicker();
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

  function drawPicker(): void {
    clear(picker);
    for (const entry of VDP_TRACE_MANIFEST) {
      const verdict = entry.id.startsWith("vdp-match") ? "fresh matches reference" : "fresh picks wrong candidate";
      picker.append(
        el(
          "button",
          { class: "seg-btn" + (entry.file === activeFile ? " active" : ""), onclick: () => selectTrace(entry.file) },
          el("span", { class: "seg-flow" }, entry.id.replace(/^vdp-/, "")),
          el("span", { class: "seg-name" }, verdict)
        )
      );
    }
  }

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

  function drawBody(): void {
    if (!trace) return;
    const t = trace;
    clear(body);

    const acc = t.accuracy;
    const accRow = el(
      "div",
      { class: "flow-payload", style: { marginTop: "10px", display: "block" } },
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
            t.freshResult.candidate ? el("div", { style: { marginTop: "4px", fontSize: "12px" } }, `→ picks ${t.freshResult.candidate}`) : ""
          ),
          el(
            "div",
            { style: { marginTop: "10px" } },
            el("b", {}, "Reference (authors' replayed perception, same images): "),
            t.referenceResult.status,
            t.referenceResult.formula ? el("div", { class: "flow-payload", style: { marginTop: "6px", display: "block" } }, t.referenceResult.formula) : "",
            t.referenceResult.candidate ? el("div", { style: { marginTop: "4px", fontSize: "12px" } }, `→ picks ${t.referenceResult.candidate}`) : ""
          )
        );

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
          el("span", { class: "seg-flow" }, `scene ${s.sceneId}`),
          el("span", { class: "seg-name" }, s.role)
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

    body.append(accRow, playRow, logBox, resultsPanel, sceneTabs, scenePanel);
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
    panel.append(
      el("div", { style: { fontSize: "13px", marginBottom: "6px" } }, el("b", {}, `Scene ${scene.sceneId} (${scene.role}) — real rendered CLEVR scene, boxes from the actual detector:`)),
      imageBox,
      grid
    );
  }

  drawPicker();
  selectTrace(activeFile);
}
