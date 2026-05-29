import type Graph from "graphology";
import type Sigma from "sigma";
import type { Note } from "../data/types";
import type { FrameTick } from "./frameLoop";
import type { GraphTuning } from "./tuning";

const SVG_NS = "http://www.w3.org/2000/svg";
const XHTML_NS = "http://www.w3.org/1999/xhtml";

// The nearest-node-to-viewport-center scan is O(N) and dominates the frame
// budget on large graphs; only re-scan every Nth frame. Drawing + easing still
// run every frame so the fade stays smooth.
const LENS_FRAME_SKIP = 4;

export interface Lens {
  /** Returns true only when the label-hide state changes (one Sigma refresh
   * to recompute which labels the lens is covering). */
  tick: FrameTick;
  destroy: () => void;
}

/**
 * Reading lens: when zoomed in, the note nearest the viewport center blooms
 * into a circular preview (title, type, lead line, first ``##``). Built once
 * in the SVG overlay and animated by direct DOM mutation each frame.
 */
export function createLens(opts: {
  overlay: SVGSVGElement;
  graph: Graph;
  sigma: Sigma;
  host: HTMLElement;
  noteMap: Map<string, Note>;
  tuning: GraphTuning;
  openNote: (id: string) => void;
}): Lens {
  const { overlay, graph, sigma, host, noteMap, tuning, openNote } = opts;

  const defs = document.createElementNS(SVG_NS, "defs");
  const clipId = `loom-lens-clip-${Math.random().toString(36).slice(2, 9)}`;
  const clipPath = document.createElementNS(SVG_NS, "clipPath");
  clipPath.setAttribute("id", clipId);
  const clipCircle = document.createElementNS(SVG_NS, "circle");
  clipCircle.setAttribute("r", "0");
  clipPath.appendChild(clipCircle);
  defs.appendChild(clipPath);

  const lensG = document.createElementNS(SVG_NS, "g");
  lensG.setAttribute("display", "none");
  lensG.style.pointerEvents = "none";

  const maskCircle = document.createElementNS(SVG_NS, "circle");
  maskCircle.setAttribute("r", "0");
  maskCircle.setAttribute("fill", "#f5f1e8");
  lensG.appendChild(maskCircle);

  const dashCircle = document.createElementNS(SVG_NS, "circle");
  dashCircle.setAttribute("r", "0");
  dashCircle.setAttribute("fill", "none");
  dashCircle.setAttribute("stroke", "currentColor");
  dashCircle.setAttribute("stroke-width", "1");
  dashCircle.setAttribute("stroke-dasharray", "2 3");
  dashCircle.setAttribute("opacity", "0.15");
  lensG.appendChild(dashCircle);

  const fo = document.createElementNS(SVG_NS, "foreignObject");
  fo.setAttribute("clip-path", `url(#${clipId})`);
  const content = document.createElementNS(
    XHTML_NS,
    "div",
  ) as unknown as HTMLDivElement;
  content.style.width = "100%";
  content.style.height = "100%";
  fo.appendChild(content);
  lensG.appendChild(fo);

  const outlineCircle = document.createElementNS(SVG_NS, "circle");
  outlineCircle.setAttribute("r", "0");
  outlineCircle.setAttribute("fill", "none");
  outlineCircle.setAttribute("stroke-width", "1.4");
  lensG.appendChild(outlineCircle);

  const hit = document.createElementNS(SVG_NS, "rect");
  hit.setAttribute("clip-path", `url(#${clipId})`);
  hit.setAttribute("fill", "transparent");
  hit.style.cursor = "pointer";
  hit.style.pointerEvents = "all";
  lensG.appendChild(hit);

  overlay.appendChild(defs);
  overlay.appendChild(lensG);

  // --- internal animation state ---
  let focusId: string | null = null;
  let openness = 0;
  let tickIdx = 0;

  const onHitClick = (): void => {
    if (focusId && openness > 0.4) openNote(focusId);
  };
  hit.addEventListener("click", onHitClick);

  const populate = (id: string): void => {
    const note = noteMap.get(id);
    if (!note) return;
    const connections = graph.degree(id);
    let firstNonHeadingLine = "";
    let firstH2 = "";
    for (const raw of note.body.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith("## ")) {
        if (!firstH2) firstH2 = line.replace(/^##\s*/, "");
      } else if (!line.startsWith("#")) {
        if (!firstNonHeadingLine) firstNonHeadingLine = line;
      }
      if (firstNonHeadingLine && firstH2) break;
    }
    const typeColor =
      (graph.getNodeAttribute(id, "color") as string) ?? "#1a1815";

    content.textContent = "";
    const wrap = document.createElement("div");
    wrap.style.cssText =
      "font-family: Fraunces, serif; color: #1a1815; line-height: 1.4; " +
      "padding: 12%; box-sizing: border-box; width: 100%; height: 100%; " +
      "display: flex; flex-direction: column; justify-content: center; " +
      "text-align: center; overflow: hidden;";

    const titleEl = document.createElement("div");
    titleEl.style.cssText =
      "font-size: 11px; font-weight: 600; margin-bottom: 3px;";
    titleEl.textContent = note.title;
    wrap.appendChild(titleEl);

    const metaEl = document.createElement("div");
    metaEl.style.cssText =
      "font-family: 'JetBrains Mono', monospace; font-size: 8px; " +
      "color: #8c877d; margin-bottom: 4px;";
    metaEl.textContent = `${note.type} · ${connections} conn`;
    wrap.appendChild(metaEl);

    if (firstNonHeadingLine) {
      const leadEl = document.createElement("div");
      leadEl.style.cssText =
        "font-size: 9.5px; color: #5c5851; font-style: italic;";
      leadEl.textContent = firstNonHeadingLine;
      wrap.appendChild(leadEl);
    }

    if (firstH2) {
      const h2El = document.createElement("div");
      h2El.style.cssText = `font-size: 9px; margin-top: 4px; font-style: italic; color: ${typeColor};`;
      h2El.textContent = `§ ${firstH2}`;
      wrap.appendChild(h2El);
    }
    content.appendChild(wrap);
  };

  const tick: FrameTick = () => {
    tickIdx++;
    const filters = tuning.filters;
    const w = host.clientWidth;
    const h = host.clientHeight;

    // Pick the focused node: nearest to viewport center (skipping filtered).
    let nearest: string | null = focusId;
    if (tickIdx % LENS_FRAME_SKIP === 0) {
      const centerGraph = sigma.viewportToGraph({ x: w / 2, y: h / 2 });
      let bestDist = Infinity;
      let scanned: string | null = null;
      graph.forEachNode((id, attr) => {
        if (filters.size > 0 && !filters.has(attr["noteType"] as string)) {
          return;
        }
        const nx = attr["x"] as number;
        const ny = attr["y"] as number;
        const d2 =
          (nx - centerGraph.x) * (nx - centerGraph.x) +
          (ny - centerGraph.y) * (ny - centerGraph.y);
        if (d2 < bestDist) {
          bestDist = d2;
          scanned = id;
        }
      });
      nearest = scanned;
    }

    const ratio = sigma.getCamera().ratio;
    const zoomOpenness = Math.max(0, Math.min(1, (0.7 - ratio) / 0.4));

    // If the focus target changes mid-fade, finish closing the old lens before
    // adopting the new one — avoids a content-swap pop.
    const current = focusId;
    const currentOpen = openness;
    let desiredId: string | null = null;
    let desiredTarget = 0;
    if (zoomOpenness > 0 && nearest && noteMap.has(nearest)) {
      if (current && current !== nearest && currentOpen > 0.02) {
        desiredId = current;
        desiredTarget = 0;
      } else {
        if (nearest !== current) {
          focusId = nearest;
          populate(nearest);
        }
        desiredId = nearest;
        desiredTarget = zoomOpenness;
      }
    } else if (current) {
      desiredId = current;
      desiredTarget = 0;
    }

    const next = currentOpen + (desiredTarget - currentOpen) * 0.15;
    const settled =
      Math.abs(desiredTarget - next) < 0.005 ? desiredTarget : next;
    openness = settled;

    if (settled <= 0.001 && desiredTarget === 0) {
      focusId = null;
      lensG.setAttribute("display", "none");
    } else if (desiredId) {
      const r = 4 + settled * 54;
      const nx = graph.getNodeAttribute(desiredId, "x") as number;
      const ny = graph.getNodeAttribute(desiredId, "y") as number;
      const p = sigma.graphToViewport({ x: nx, y: ny });
      const typeColor =
        (graph.getNodeAttribute(desiredId, "color") as string) ?? "#1a1815";
      lensG.setAttribute("display", "");
      lensG.setAttribute("transform", `translate(${p.x},${p.y})`);
      lensG.style.color = typeColor;
      lensG.style.opacity = String(Math.min(1, settled * 1.5));
      maskCircle.setAttribute("r", String(r));
      clipCircle.setAttribute("r", String(r));
      dashCircle.setAttribute("r", String(r + 6));
      outlineCircle.setAttribute("r", String(r));
      outlineCircle.setAttribute("stroke", typeColor);
      fo.setAttribute("x", String(-r));
      fo.setAttribute("y", String(-r));
      fo.setAttribute("width", String(r * 2));
      fo.setAttribute("height", String(r * 2));
      hit.setAttribute("x", String(-r));
      hit.setAttribute("y", String(-r));
      hit.setAttribute("width", String(r * 2));
      hit.setAttribute("height", String(r * 2));
    }

    // Signal a Sigma refresh only when the label-hide target actually changes.
    const newHide =
      desiredId && settled > 0.4 && desiredTarget > 0 ? desiredId : null;
    if (newHide !== tuning.lensLabelHideFor) {
      tuning.lensLabelHideFor = newHide;
      return true;
    }
    return false;
  };

  const destroy = (): void => {
    hit.removeEventListener("click", onHitClick);
    lensG.remove();
    defs.remove();
    tuning.lensLabelHideFor = null;
  };

  return { tick, destroy };
}
