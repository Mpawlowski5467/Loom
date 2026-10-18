import type Graph from "graphology";
import type Sigma from "sigma";
import { depthSizeFactorFor } from "./depth";
import type { FrameTick } from "./frameLoop";
import type { GraphTuning } from "./tuning";
import {
  blankLineCache,
  hideLine,
  scaleSizeFor,
  setCircleAttr,
  setLineAttr,
  type CircleCache,
  type LineCache,
} from "./travelerDom";

const SVG_NS = "http://www.w3.org/2000/svg";
const SEG_LEN = 14;
const BASE_SPEED = 0.18;
const NODE_MARGIN = 2;

export interface Travelers {
  /** Mutates the overlay DOM only — never needs a Sigma repaint, so returns
   * false. */
  tick: FrameTick;
  /** Re-match lines and node masks to the live graph after nodes or edges
   * were added or removed in place. */
  sync: () => void;
  destroy: () => void;
}

/**
 * Edge "travelers": a short dash that slides along each edge from source to
 * target. One ``<line>`` per edge plus a mask that punches a hole at every
 * node disk, all animated by direct DOM mutation each frame (React state would
 * re-render the tree 60×/sec). Driven by the shared frame loop.
 */
export function createTravelers(opts: {
  overlay: SVGSVGElement;
  graph: Graph;
  sigma: Sigma;
  tuning: GraphTuning;
}): Travelers {
  const { overlay, graph, sigma, tuning } = opts;

  const defs = document.createElementNS(SVG_NS, "defs");
  const maskId = `loom-trav-mask-${Math.random().toString(36).slice(2, 9)}`;
  const trMask = document.createElementNS(SVG_NS, "mask");
  trMask.setAttribute("id", maskId);
  trMask.setAttribute("maskUnits", "userSpaceOnUse");
  const maskBg = document.createElementNS(SVG_NS, "rect");
  maskBg.setAttribute("x", "0");
  maskBg.setAttribute("y", "0");
  maskBg.setAttribute("width", "100%");
  maskBg.setAttribute("height", "100%");
  maskBg.setAttribute("fill", "white");
  trMask.appendChild(maskBg);

  const maskCircles = new Map<string, SVGCircleElement>();
  const addMaskCircle = (id: string): void => {
    const c = document.createElementNS(SVG_NS, "circle");
    c.setAttribute("fill", "black");
    c.setAttribute("r", "0");
    trMask.appendChild(c);
    maskCircles.set(id, c);
  };
  graph.forEachNode(addMaskCircle);
  defs.appendChild(trMask);

  const travG = document.createElementNS(SVG_NS, "g");
  travG.setAttribute("mask", `url(#${maskId})`);
  // ``offset`` staggers each dash along its edge. It is fixed at creation so
  // a later sync does not make surviving travelers jump.
  let lines: Array<{
    edge: string;
    el: SVGLineElement;
    s: string;
    t: string;
    offset: number;
  }> = [];
  let created = 0;
  const addLine = (edge: string, source: string, target: string): void => {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("stroke", "currentColor");
    line.setAttribute("stroke-width", "2.0");
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("opacity", "0.92");
    travG.appendChild(line);
    lines.push({ edge, el: line, s: source, t: target, offset: created * 0.1 });
    created++;
  };
  graph.forEachEdge((edge, _attr, source, target) =>
    addLine(edge, source, target),
  );
  overlay.appendChild(defs);
  overlay.appendChild(travG);

  const lineCache = new Map<SVGLineElement, LineCache>();
  const maskCache = new Map<SVGCircleElement, CircleCache>();

  const cacheFor = (el: SVGLineElement): LineCache => {
    let cache = lineCache.get(el);
    if (!cache) {
      cache = blankLineCache();
      lineCache.set(el, cache);
    }
    return cache;
  };

  const scaleSize = scaleSizeFor(sigma);

  let pausedForDrag = false;
  const tick: FrameTick = () => {
    const hovered = tuning.hovered;
    const pace = tuning.travelerPace;
    const now = performance.now();

    if (tuning.dragging) {
      if (!pausedForDrag) {
        for (let i = 0; i < lines.length; i++) {
          hideLine(lines[i]!.el, cacheFor(lines[i]!.el));
        }
        pausedForDrag = true;
      }
      return false;
    }
    pausedForDrag = false;

    if (!tuning.travelersEnabled) {
      for (let i = 0; i < lines.length; i++) {
        hideLine(lines[i]!.el, cacheFor(lines[i]!.el));
      }
      return false;
    }

    for (let i = 0; i < lines.length; i++) {
      const { el, s, t, offset } = lines[i]!;
      const cache = cacheFor(el);

      if (pace <= 0) {
        hideLine(el, cache);
        continue;
      }

      // Reject invisible edges before coordinate conversion, depth math, and
      // DOM work. Filters write the same hidden state used by Sigma + physics.
      if (
        graph.getNodeAttribute(s, "hidden") ||
        graph.getNodeAttribute(t, "hidden")
      ) {
        hideLine(el, cache);
        continue;
      }

      // Depths only affect the disk-trim radii below; the hovered node pops
      // to z = 0 (full size) to mirror the node reducer's exemption.
      const sz =
        s === hovered
          ? 0
          : ((graph.getNodeAttribute(s, "z") as number | undefined) ?? 0);
      const tz =
        t === hovered
          ? 0
          : ((graph.getNodeAttribute(t, "z") as number | undefined) ?? 0);
      const sx = graph.getNodeAttribute(s, "x") as number;
      const sy = graph.getNodeAttribute(s, "y") as number;
      const tx = graph.getNodeAttribute(t, "x") as number;
      const ty = graph.getNodeAttribute(t, "y") as number;
      const p1 = sigma.graphToViewport({ x: sx, y: sy });
      const p2 = sigma.graphToViewport({ x: tx, y: ty });
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy);
      if (len < 1) {
        hideLine(el, cache);
        continue;
      }

      // Trim the travel range to the gap between the two node disks so the
      // segment never overlaps a node's pixel radius (depth-shrunk when on).
      const sRadius =
        scaleSize(
          (graph.getNodeAttribute(s, "size") as number) *
            depthSizeFactorFor(tuning, sz),
        ) + NODE_MARGIN;
      const tRadius =
        scaleSize(
          (graph.getNodeAttribute(t, "size") as number) *
            depthSizeFactorFor(tuning, tz),
        ) + NODE_MARGIN;
      const travStart = Math.min(len, sRadius);
      const travEnd = Math.max(travStart, len - tRadius);
      const travLen = travEnd - travStart;
      if (travLen < 1) {
        hideLine(el, cache);
        continue;
      }

      const ux = dx / len;
      const uy = dy / len;
      const phase = ((now / 1000) * BASE_SPEED * pace + offset) % 1;
      const center = travStart + phase * travLen;
      const segStart = Math.max(travStart, center - SEG_LEN / 2);
      const segEnd = Math.min(travEnd, center + SEG_LEN / 2);

      const k = tuning.edgeThickness;
      let op = "0.92";
      let sw = String(2.0 * k);
      if (hovered) {
        const incident = s === hovered || t === hovered;
        op = incident ? "0.92" : "0.15";
        sw = incident ? String(2.4 * k) : String(2.0 * k);
      }
      setLineAttr(
        el,
        cache,
        String(p1.x + ux * segStart),
        String(p1.y + uy * segStart),
        String(p1.x + ux * segEnd),
        String(p1.y + uy * segEnd),
        op,
        sw,
      );
    }

    // Update per-node mask circles so travelers never render inside a node's
    // disk — including unrelated nodes an edge passes through. Filtered nodes
    // get r=0 so they don't mask empty space.
    graph.forEachNode((id, attr) => {
      const c = maskCircles.get(id);
      if (!c) return;
      let mc = maskCache.get(c);
      if (!mc) {
        mc = { cx: "", cy: "", r: "" };
        maskCache.set(c, mc);
      }
      if (attr["hidden"]) {
        setCircleAttr(c, mc, mc.cx, mc.cy, "0");
        return;
      }
      const z = id === hovered ? 0 : ((attr["z"] as number | undefined) ?? 0);
      const p = sigma.graphToViewport({
        x: attr["x"] as number,
        y: attr["y"] as number,
      });
      const r =
        scaleSize((attr["size"] as number) * depthSizeFactorFor(tuning, z)) +
        NODE_MARGIN;
      setCircleAttr(c, mc, String(p.x), String(p.y), String(r));
    });

    return false;
  };

  const sync = (): void => {
    for (const [id, c] of maskCircles) {
      if (graph.hasNode(id)) continue;
      c.remove();
      maskCache.delete(c);
      maskCircles.delete(id);
    }
    graph.forEachNode((id) => {
      if (!maskCircles.has(id)) addMaskCircle(id);
    });
    const kept = new Set<string>();
    lines = lines.filter((line) => {
      if (graph.hasEdge(line.edge)) {
        kept.add(line.edge);
        return true;
      }
      line.el.remove();
      lineCache.delete(line.el);
      return false;
    });
    graph.forEachEdge((edge, _attr, source, target) => {
      if (!kept.has(edge)) addLine(edge, source, target);
    });
    // New lines start visible; let the next drag frame hide them all again.
    pausedForDrag = false;
  };

  const destroy = (): void => {
    travG.remove();
    defs.remove();
    lineCache.clear();
    maskCache.clear();
    maskCircles.clear();
    lines.length = 0;
  };

  return { tick, sync, destroy };
}
