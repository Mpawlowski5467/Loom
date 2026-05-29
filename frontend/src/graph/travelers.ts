import type Graph from "graphology";
import type Sigma from "sigma";
import type { FrameTick } from "./frameLoop";
import type { GraphTuning } from "./tuning";

const SVG_NS = "http://www.w3.org/2000/svg";
const SEG_LEN = 14;
const BASE_SPEED = 0.18;
const NODE_MARGIN = 2;

interface LineCache {
  x1: string;
  y1: string;
  x2: string;
  y2: string;
  op: string;
  sw: string;
}

function blankLineCache(): LineCache {
  return { x1: "", y1: "", x2: "", y2: "", op: "", sw: "" };
}

export interface Travelers {
  /** Mutates the overlay DOM only — never needs a Sigma repaint, so returns
   * false. */
  tick: FrameTick;
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
  graph.forEachNode((id) => {
    const c = document.createElementNS(SVG_NS, "circle");
    c.setAttribute("fill", "black");
    c.setAttribute("r", "0");
    trMask.appendChild(c);
    maskCircles.set(id, c);
  });
  defs.appendChild(trMask);

  const travG = document.createElementNS(SVG_NS, "g");
  travG.setAttribute("mask", `url(#${maskId})`);
  const lines: Array<{ el: SVGLineElement; s: string; t: string }> = [];
  graph.forEachEdge((_edgeId, _attr, source, target) => {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("stroke", "currentColor");
    line.setAttribute("stroke-width", "2.0");
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("opacity", "0.92");
    travG.appendChild(line);
    lines.push({ el: line, s: source, t: target });
  });
  overlay.appendChild(defs);
  overlay.appendChild(travG);

  const lineCache = new Map<SVGLineElement, LineCache>();
  const maskCache = new Map<
    SVGCircleElement,
    { cx: string; cy: string; r: string }
  >();

  const setLineAttr = (
    el: SVGLineElement,
    cache: LineCache,
    x1: string,
    y1: string,
    x2: string,
    y2: string,
    op: string,
    sw: string,
  ): void => {
    if (cache.x1 !== x1) { el.setAttribute("x1", x1); cache.x1 = x1; }
    if (cache.y1 !== y1) { el.setAttribute("y1", y1); cache.y1 = y1; }
    if (cache.x2 !== x2) { el.setAttribute("x2", x2); cache.x2 = x2; }
    if (cache.y2 !== y2) { el.setAttribute("y2", y2); cache.y2 = y2; }
    if (cache.op !== op) { el.setAttribute("opacity", op); cache.op = op; }
    if (cache.sw !== sw) { el.setAttribute("stroke-width", sw); cache.sw = sw; }
  };

  const hideLine = (el: SVGLineElement, cache: LineCache): void => {
    if (cache.op !== "0") {
      el.setAttribute("opacity", "0");
      cache.op = "0";
    }
  };

  const cacheFor = (el: SVGLineElement): LineCache => {
    let cache = lineCache.get(el);
    if (!cache) {
      cache = blankLineCache();
      lineCache.set(el, cache);
    }
    return cache;
  };

  // Sigma 3's scaleSize() converts logical node sizes to viewport pixels at
  // the current camera ratio. Older versions don't expose it — fall back to
  // its formula so the disk trim still tracks zoom.
  const scaleSize: (size: number) => number =
    typeof (sigma as unknown as { scaleSize?: (s: number) => number })
      .scaleSize === "function"
      ? (
          sigma as unknown as { scaleSize: (s: number) => number }
        ).scaleSize.bind(sigma)
      : (s: number) => s / Math.sqrt(sigma.getCamera().ratio);

  const tick: FrameTick = () => {
    const hovered = tuning.hovered;
    const filters = tuning.filters;
    const pace = tuning.travelerPace;
    const now = performance.now();

    if (!tuning.travelersEnabled) {
      for (let i = 0; i < lines.length; i++) {
        hideLine(lines[i]!.el, cacheFor(lines[i]!.el));
      }
      return false;
    }

    for (let i = 0; i < lines.length; i++) {
      const { el, s, t } = lines[i]!;
      const cache = cacheFor(el);

      if (pace <= 0) {
        hideLine(el, cache);
        continue;
      }

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
      // segment never overlaps a node's pixel radius.
      const sRadius =
        scaleSize(graph.getNodeAttribute(s, "size") as number) + NODE_MARGIN;
      const tRadius =
        scaleSize(graph.getNodeAttribute(t, "size") as number) + NODE_MARGIN;
      const travStart = Math.min(len, sRadius);
      const travEnd = Math.max(travStart, len - tRadius);
      const travLen = travEnd - travStart;
      if (travLen < 1) {
        hideLine(el, cache);
        continue;
      }

      if (filters.size > 0) {
        const sType = graph.getNodeAttribute(s, "noteType") as string;
        const tType = graph.getNodeAttribute(t, "noteType") as string;
        if (!filters.has(sType) || !filters.has(tType)) {
          hideLine(el, cache);
          continue;
        }
      }

      const ux = dx / len;
      const uy = dy / len;
      const phase = ((now / 1000) * BASE_SPEED * pace + i * 0.1) % 1;
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
      if (filters.size > 0 && !filters.has(attr["noteType"] as string)) {
        if (mc.r !== "0") {
          c.setAttribute("r", "0");
          mc.r = "0";
        }
        return;
      }
      const p = sigma.graphToViewport({
        x: attr["x"] as number,
        y: attr["y"] as number,
      });
      const r = scaleSize(attr["size"] as number) + NODE_MARGIN;
      const cx = String(p.x);
      const cy = String(p.y);
      const rs = String(r);
      if (mc.cx !== cx) { c.setAttribute("cx", cx); mc.cx = cx; }
      if (mc.cy !== cy) { c.setAttribute("cy", cy); mc.cy = cy; }
      if (mc.r !== rs) { c.setAttribute("r", rs); mc.r = rs; }
    });

    return false;
  };

  const destroy = (): void => {
    travG.remove();
    defs.remove();
    lineCache.clear();
    maskCache.clear();
    maskCircles.clear();
    lines.length = 0;
  };

  return { tick, destroy };
}
