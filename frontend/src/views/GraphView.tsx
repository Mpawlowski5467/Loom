import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type Graph from "graphology";
import type Sigma from "sigma";
import { useApp } from "../context/app-ctx";
import { GraphToolbar } from "../components/graph/GraphToolbar";
import type { ExportFormat } from "../components/graph/GraphToolbar";
import {
  exportGraphJson,
  exportGraphPng,
  exportGraphSvg,
} from "../graph/export";
import { startBreathing } from "../graph/breathing";
import {
  applyConstellationLayout,
  computeOrbitScene,
  easeInOutCubic,
  ORBIT_SCENES,
  ORBIT_SCENE_LABELS,
  type OrbitScene,
  type XY,
} from "../graph/layouts";
import {
  applyPaletteToGraph,
  buildGraph,
  createSigma,
  readEdgePalette,
  type EdgePalette,
} from "../graph/sigma-setup";
import { attachDrag } from "../graph/dragHandlers";
import { startLayoutTween } from "../graph/layoutTransition";

function spacingToCameraRatio(scale: number): number {
  return 1 / scale;
}

/**
 * Zoom-tiered label visibility.
 *
 * Returns the minimum degree a node must have to show its label at the given
 * camera ratio. ``labelKnob`` is the user slider (1..20): lower = more labels,
 * higher = fewer. The tiers are derived from a base step at ratio 1.0, then
 * scaled by zoom — far zoom-in shows everything, far zoom-out shows only the
 * highest-degree anchors.
 *
 * Returns ``Infinity`` to mean "no labels at all" (knob slammed off).
 */
function labelDegreeFloor(ratio: number, labelKnob: number): number {
  if (labelKnob >= 19) return Infinity;
  if (labelKnob <= 1) return 0;
  // Base floor at the user's slider position, normalized to [0..6].
  const base = (labelKnob - 1) * (6 / 18);
  // Zoom multiplier: <0.4 ratio → ~0.4×, 0.4..1.0 → ~1.0×, >1.0 → linear up.
  let zoomMul: number;
  if (ratio < 0.4) zoomMul = 0.4;
  else if (ratio < 1.0) zoomMul = 1.0;
  else zoomMul = 1.0 + (ratio - 1.0) * 1.2;
  return Math.round(base * zoomMul);
}

function ratioToTier(ratio: number): number {
  if (ratio < 0.4) return 0;
  if (ratio < 1.0) return 1;
  if (ratio < 2.0) return 2;
  return 3;
}

export function GraphView(): ReactNode {
  const {
    notes,
    openNote,
    graphMode,
    setGraphMode,
    graphFocusId,
    setGraphFocusId,
    graphFilters,
    toggleGraphFilter,
    graphDisplay,
    theme,
    pushToast,
  } = useApp();

  const hostRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<SVGSVGElement | null>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const hoveredRef = useRef<string | null>(null);
  const baseSizesRef = useRef<Map<string, number>>(new Map());
  const stopBreathRef = useRef<(() => void) | null>(null);
  const tweenRafRef = useRef<number>(0);
  const travelerRafRef = useRef<number>(0);
  const travelerLinesRef = useRef<
    Array<{ el: SVGLineElement; s: string; t: string }>
  >([]);
  const travelerMaskCirclesRef = useRef<Map<string, SVGCircleElement>>(
    new Map(),
  );
  const lensGroupRef = useRef<SVGGElement | null>(null);
  const lensMaskRef = useRef<SVGCircleElement | null>(null);
  const lensClipCircleRef = useRef<SVGCircleElement | null>(null);
  const lensOutlineRef = useRef<SVGCircleElement | null>(null);
  const lensDashRef = useRef<SVGCircleElement | null>(null);
  const lensForeignRef = useRef<SVGForeignObjectElement | null>(null);
  const lensContentRef = useRef<HTMLDivElement | null>(null);
  const lensHitRef = useRef<SVGRectElement | null>(null);
  const lensFocusIdRef = useRef<string | null>(null);
  const lensOpennessRef = useRef<number>(0);
  const lensLabelHideForRef = useRef<string | null>(null);
  const paletteRef = useRef<EdgePalette>(readEdgePalette());

  const sizeScaleRef = useRef<number>(graphDisplay.nodeSizeScale);
  const travelerPaceRef = useRef<number>(graphDisplay.travelerPace);
  const isDraggingRef = useRef<boolean>(false);
  const justDraggedRef = useRef<boolean>(false);
  const orbitTargetsRef = useRef<Map<string, XY>>(new Map());
  const basePositionsRef = useRef<Map<string, XY>>(new Map());
  const degreeRef = useRef<Map<string, number>>(new Map());
  const cameraRatioRef = useRef<number>(1);
  const labelThresholdRef = useRef<number>(graphDisplay.labelThreshold);
  const labelTierRef = useRef<number>(-1);
  const labelsEnabledRef = useRef<boolean>(graphDisplay.labelsEnabled);
  const labelShowRatioRef = useRef<number>(graphDisplay.labelShowRatio);
  const travelersEnabledRef = useRef<boolean>(graphDisplay.travelersEnabled);
  const edgeThicknessRef = useRef<number>(graphDisplay.edgeThickness);
  const [sigmaReady, setSigmaReady] = useState(0);

  const stats = useMemo(
    () => ({
      nodes: notes.length,
      edges: notes.reduce((a, n) => a + n.links.length, 0),
    }),
    [notes],
  );

  // Build graph + sigma exactly once per notes set.
  useEffect(() => {
    if (!hostRef.current) return;
    const { graph, baseSizes } = buildGraph(notes);
    baseSizesRef.current = baseSizes;
    graphRef.current = graph;
    basePositionsRef.current = applyConstellationLayout(graph);

    const degreeMap = new Map<string, number>();
    graph.forEachNode((id) => {
      degreeMap.set(id, graph.degree(id));
    });
    degreeRef.current = degreeMap;

    const sigma = createSigma(graph, hostRef.current);
    cameraRatioRef.current = sigma.getCamera().ratio;
    labelTierRef.current = ratioToTier(cameraRatioRef.current);
    sigmaRef.current = sigma;
    if (import.meta.env.DEV) {
      (window as unknown as { __loomGraph: unknown }).__loomGraph = {
        sigma,
        graph,
        graphToViewport: (id: string) => {
          const x = graph.getNodeAttribute(id, "x") as number;
          const y = graph.getNodeAttribute(id, "y") as number;
          return sigma.graphToViewport({ x, y });
        },
      };
    }

    sigma.setSetting("nodeReducer", (id, data) => {
      const hovered = hoveredRef.current;
      const filtered =
        graphFiltersRef.current.size > 0 &&
        !graphFiltersRef.current.has(data["noteType"] as string);
      if (filtered) {
        return { ...data, hidden: true };
      }

      // Hover overrides every other label rule: the hovered node always shows
      // its label; everything else hides its label until hover ends.
      if (hovered) {
        if (id === hovered) {
          const lensHide = id === lensLabelHideForRef.current;
          return lensHide ? { ...data, label: "" } : data;
        }
        const isNeighbor =
          graph.hasEdge(hovered, id) || graph.hasEdge(id, hovered);
        if (isNeighbor) return { ...data, label: "" };
        return { ...data, color: paletteRef.current.nodeDimmed, label: "" };
      }

      // Master gates: labels-off and zoom-from beat the degree floor.
      if (!labelsEnabledRef.current) return { ...data, label: "" };
      if (cameraRatioRef.current > labelShowRatioRef.current) {
        return { ...data, label: "" };
      }

      // Zoom-tiered visibility — stable across breathing pulses because it
      // reads cached degree + camera ratio, not animated size.
      const floor = labelDegreeFloor(
        cameraRatioRef.current,
        labelThresholdRef.current,
      );
      const degree = degreeRef.current.get(id) ?? 0;
      const lensHide = id === lensLabelHideForRef.current;
      if (lensHide || degree < floor) return { ...data, label: "" };
      return data;
    });

    sigma.setSetting("edgeReducer", (id, data) => {
      const hovered = hoveredRef.current;
      const k = edgeThicknessRef.current;
      const baseSize = (data.size ?? 1) * k;
      if (!hovered) return { ...data, size: baseSize };
      const ext = graph.extremities(id);
      if (ext[0] === hovered || ext[1] === hovered) {
        return {
          ...data,
          color: paletteRef.current.edgeHover,
          size: 1.4 * k,
        };
      }
      return { ...data, color: paletteRef.current.edgeFaint, size: baseSize };
    });

    // Camera ratio drives the label tier — refresh only when the tier flips,
    // not on every zoom frame. Sigma itself already repaints per frame during
    // the camera animation; this just keeps the nodeReducer's view of the
    // ratio current and forces a label recompute at tier boundaries.
    const onCameraUpdate = () => {
      const r = sigma.getCamera().ratio;
      const prevRatio = cameraRatioRef.current;
      cameraRatioRef.current = r;
      const tier = ratioToTier(r);
      const showRatio = labelShowRatioRef.current;
      const crossedShowRatio =
        (prevRatio <= showRatio) !== (r <= showRatio);
      if (tier !== labelTierRef.current || crossedShowRatio) {
        labelTierRef.current = tier;
        sigma.refresh({ skipIndexation: true });
      }
    };
    sigma.getCamera().on("updated", onCameraUpdate);

    sigma.on("enterNode", ({ node }) => {
      if (isDraggingRef.current) return;
      hoveredRef.current = node;
      sigma.refresh({ skipIndexation: true });
    });
    sigma.on("leaveNode", () => {
      if (isDraggingRef.current) return;
      hoveredRef.current = null;
      sigma.refresh({ skipIndexation: true });
    });
    sigma.on("clickNode", ({ node }) => {
      if (isDraggingRef.current || justDraggedRef.current) return;
      if (graphModeRef.current === "orbit") {
        setGraphFocusId(node);
      } else {
        openNote(node);
      }
    });
    sigma.on("doubleClickNode", ({ node, event }) => {
      event.preventSigmaDefault?.();
      openNote(node);
    });

    const detachDrag = attachDrag({
      sigma,
      graph,
      getSnapTarget: (id) =>
        graphModeRef.current === "orbit"
          ? orbitTargetsRef.current.get(id)
          : basePositionsRef.current.get(id),
      hoveredRef,
      tweenRafRef,
      isDragging: isDraggingRef,
      justDragged: justDraggedRef,
    });

    setSigmaReady((v) => v + 1);

    const ro = new ResizeObserver(() => {
      sigma.resize();
      sigma.refresh();
    });
    ro.observe(hostRef.current);

    const reset = setTimeout(() => {
      sigma.getCamera().animatedReset({
        duration: 600,
        easing: easeInOutCubic,
      });
    }, 200);

    const cancelTween = () => {
      cancelAnimationFrame(tweenRafRef.current);
    };

    // Travelers + lens: pre-allocate one <line> per edge plus a single lens
    // <g> in the SVG overlay, then animate them via direct DOM mutation in a
    // raf loop (React state would re-render the tree every frame).
    const overlay = overlayRef.current;
    const SVG_NS = "http://www.w3.org/2000/svg";
    const XHTML_NS = "http://www.w3.org/1999/xhtml";
    const noteMap = new Map(notes.map((n) => [n.id, n]));
    if (overlay) {
      while (overlay.firstChild) overlay.removeChild(overlay.firstChild);

      // Build a mask that punches a hole at every node so traveler lines
      // never appear inside a node's disk (including pass-through hits on
      // unrelated nodes mid-edge). Per-node circles are positioned in
      // viewport coords each frame inside tickTravelers.
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
      travelerMaskCirclesRef.current = maskCircles;

      const travG = document.createElementNS(SVG_NS, "g");
      travG.setAttribute("mask", `url(#${maskId})`);
      const lines: typeof travelerLinesRef.current = [];
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
      travelerLinesRef.current = lines;

      // Lens DOM (built once per effect; siblings after the travelers so it
      // paints on top in z-order).
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
      hit.addEventListener("click", () => {
        const id = lensFocusIdRef.current;
        if (id && lensOpennessRef.current > 0.4) openNote(id);
      });
      lensG.appendChild(hit);

      overlay.appendChild(lensG);

      lensGroupRef.current = lensG;
      lensMaskRef.current = maskCircle;
      lensClipCircleRef.current = clipCircle;
      lensDashRef.current = dashCircle;
      lensForeignRef.current = fo;
      lensContentRef.current = content;
      lensOutlineRef.current = outlineCircle;
      lensHitRef.current = hit;
    }

    const populateLensContent = (id: string): void => {
      const note = noteMap.get(id);
      const content = lensContentRef.current;
      if (!note || !content) return;
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

    const SEG_LEN = 14;
    const BASE_SPEED = 0.18;
    const NODE_MARGIN = 2;
    // Lens lookup (nearest-node-to-viewport-center) only runs every Nth frame.
    // The result barely changes between frames during gentle pans, and we
    // re-trigger immediately on hover or camera updates anyway.
    const LENS_FRAME_SKIP = 4;
    let tickIdx = 0;
    // Cache last-written DOM attribute values per traveler line + per mask
    // circle so we can skip setAttribute() calls when values are unchanged.
    // setAttribute is a surprisingly hot path on graphs with many edges.
    const lineCache = new Map<
      SVGLineElement,
      {
        x1: string;
        y1: string;
        x2: string;
        y2: string;
        op: string;
        sw: string;
      }
    >();
    const setLineAttr = (
      el: SVGLineElement,
      cache: { x1: string; y1: string; x2: string; y2: string; op: string; sw: string },
      x1: string,
      y1: string,
      x2: string,
      y2: string,
      op: string,
      sw: string,
    ) => {
      if (cache.x1 !== x1) { el.setAttribute("x1", x1); cache.x1 = x1; }
      if (cache.y1 !== y1) { el.setAttribute("y1", y1); cache.y1 = y1; }
      if (cache.x2 !== x2) { el.setAttribute("x2", x2); cache.x2 = x2; }
      if (cache.y2 !== y2) { el.setAttribute("y2", y2); cache.y2 = y2; }
      if (cache.op !== op) { el.setAttribute("opacity", op); cache.op = op; }
      if (cache.sw !== sw) { el.setAttribute("stroke-width", sw); cache.sw = sw; }
    };
    const maskCache = new Map<SVGCircleElement, { cx: string; cy: string; r: string }>();
    // Sigma 3's scaleSize() converts logical node sizes to viewport pixels at
    // the current camera ratio. Older versions don't expose it — fall back to
    // its formula so the trim still tracks zoom.
    const scaleSize: (size: number) => number =
      typeof (sigma as unknown as { scaleSize?: (s: number) => number })
        .scaleSize === "function"
        ? (sigma as unknown as { scaleSize: (s: number) => number }).scaleSize.bind(
            sigma,
          )
        : (s: number) => s / Math.sqrt(sigma.getCamera().ratio);

    const tickTravelers = () => {
      tickIdx++;
      const lines = travelerLinesRef.current;
      const hovered = hoveredRef.current;
      const filters = graphFiltersRef.current;
      const pace = travelerPaceRef.current;
      const travelersOn = travelersEnabledRef.current;
      const now = performance.now();

      if (!travelersOn) {
        for (let i = 0; i < lines.length; i++) {
          const el = lines[i]!.el;
          let cache = lineCache.get(el);
          if (!cache) {
            cache = { x1: "", y1: "", x2: "", y2: "", op: "", sw: "" };
            lineCache.set(el, cache);
          }
          if (cache.op !== "0") {
            el.setAttribute("opacity", "0");
            cache.op = "0";
          }
        }
        // Skip the per-edge geometry + mask updates, but keep the lens pass
        // alive at the bottom of this tick.
      } else {
      for (let i = 0; i < lines.length; i++) {
        const { el, s, t } = lines[i]!;
        let cache = lineCache.get(el);
        if (!cache) {
          cache = { x1: "", y1: "", x2: "", y2: "", op: "", sw: "" };
          lineCache.set(el, cache);
        }

        if (pace <= 0) {
          if (cache.op !== "0") {
            el.setAttribute("opacity", "0");
            cache.op = "0";
          }
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
          if (cache.op !== "0") {
            el.setAttribute("opacity", "0");
            cache.op = "0";
          }
          continue;
        }

        // Trim the travel range to the gap between the two node disks, so the
        // segment never overlaps a node's pixel radius and the dots stay
        // visually solid.
        const sRadius =
          scaleSize(graph.getNodeAttribute(s, "size") as number) + NODE_MARGIN;
        const tRadius =
          scaleSize(graph.getNodeAttribute(t, "size") as number) + NODE_MARGIN;
        const travStart = Math.min(len, sRadius);
        const travEnd = Math.max(travStart, len - tRadius);
        const travLen = travEnd - travStart;
        if (travLen < 1) {
          if (cache.op !== "0") {
            el.setAttribute("opacity", "0");
            cache.op = "0";
          }
          continue;
        }

        if (filters.size > 0) {
          const sType = graph.getNodeAttribute(s, "noteType") as string;
          const tType = graph.getNodeAttribute(t, "noteType") as string;
          if (!filters.has(sType) || !filters.has(tType)) {
            if (cache.op !== "0") {
              el.setAttribute("opacity", "0");
              cache.op = "0";
            }
            continue;
          }
        }

        const ux = dx / len;
        const uy = dy / len;
        const phase = ((now / 1000) * BASE_SPEED * pace + i * 0.1) % 1;
        const center = travStart + phase * travLen;
        const segStart = Math.max(travStart, center - SEG_LEN / 2);
        const segEnd = Math.min(travEnd, center + SEG_LEN / 2);

        const k = edgeThicknessRef.current;
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

      // Update the per-node mask circles so travelers don't render inside
      // any node's disk — including unrelated nodes the edge passes through.
      // Filtered (hidden) nodes get r=0 so they don't mask empty space.
      const maskCircles = travelerMaskCirclesRef.current;
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
      }

      // --- Lens --------------------------------------------------------------
      // Pick the focused node: nearest to viewport center (skipping filtered).
      // The full nearest-node scan is O(N) and dominates the traveler frame
      // budget on large graphs; only re-scan every Nth tick. Drawing and
      // easing still run every frame so the lens fade stays smooth.
      const host = hostRef.current;
      const lensG = lensGroupRef.current;
      if (host && lensG) {
        const w = host.clientWidth;
        const h = host.clientHeight;
        let nearest: string | null = lensFocusIdRef.current;
        if (tickIdx % LENS_FRAME_SKIP === 0) {
          const centerGraph = sigma.viewportToGraph({ x: w / 2, y: h / 2 });
          let bestDist = Infinity;
          let scanned: string | null = null;
          graph.forEachNode((id, attr) => {
            if (filters.size > 0) {
              const nType = attr["noteType"] as string;
              if (!filters.has(nType)) return;
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

        // If the focus target changes mid-fade, finish closing the old lens
        // before adopting the new one — avoids a content-swap pop.
        const current = lensFocusIdRef.current;
        const currentOpen = lensOpennessRef.current;
        let desiredId: string | null = null;
        let desiredTarget = 0;
        if (zoomOpenness > 0 && nearest && noteMap.has(nearest)) {
          if (current && current !== nearest && currentOpen > 0.02) {
            desiredId = current;
            desiredTarget = 0;
          } else {
            if (nearest !== current) {
              lensFocusIdRef.current = nearest;
              populateLensContent(nearest);
            }
            desiredId = nearest;
            desiredTarget = zoomOpenness;
          }
        } else if (current) {
          desiredId = current;
          desiredTarget = 0;
        }

        // Ease openness toward target.
        const next = currentOpen + (desiredTarget - currentOpen) * 0.15;
        const settled =
          Math.abs(desiredTarget - next) < 0.005 ? desiredTarget : next;
        lensOpennessRef.current = settled;

        if (settled <= 0.001 && desiredTarget === 0) {
          // Fully closed — release the focus so the next opening can target a
          // different node.
          lensFocusIdRef.current = null;
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
          lensMaskRef.current?.setAttribute("r", String(r));
          lensClipCircleRef.current?.setAttribute("r", String(r));
          lensDashRef.current?.setAttribute("r", String(r + 6));
          lensOutlineRef.current?.setAttribute("r", String(r));
          lensOutlineRef.current?.setAttribute("stroke", typeColor);
          const fo = lensForeignRef.current;
          const hit = lensHitRef.current;
          if (fo) {
            fo.setAttribute("x", String(-r));
            fo.setAttribute("y", String(-r));
            fo.setAttribute("width", String(r * 2));
            fo.setAttribute("height", String(r * 2));
          }
          if (hit) {
            hit.setAttribute("x", String(-r));
            hit.setAttribute("y", String(-r));
            hit.setAttribute("width", String(r * 2));
            hit.setAttribute("height", String(r * 2));
          }
        }

        // Refresh Sigma only when the label-hide state actually changes.
        const newHide =
          desiredId && settled > 0.4 && desiredTarget > 0 ? desiredId : null;
        if (newHide !== lensLabelHideForRef.current) {
          lensLabelHideForRef.current = newHide;
          sigma.refresh({ skipIndexation: true });
        }
      }

      travelerRafRef.current = requestAnimationFrame(tickTravelers);
    };
    travelerRafRef.current = requestAnimationFrame(tickTravelers);

    return () => {
      clearTimeout(reset);
      ro.disconnect();
      stopBreathRef.current?.();
      detachDrag();
      cancelTween();
      sigma.getCamera().off("updated", onCameraUpdate);
      cancelAnimationFrame(travelerRafRef.current);
      if (overlay) {
        while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
      }
      travelerLinesRef.current = [];
      lensGroupRef.current = null;
      lensMaskRef.current = null;
      lensClipCircleRef.current = null;
      lensDashRef.current = null;
      lensOutlineRef.current = null;
      lensForeignRef.current = null;
      lensContentRef.current = null;
      lensHitRef.current = null;
      lensFocusIdRef.current = null;
      lensOpennessRef.current = 0;
      lensLabelHideForRef.current = null;
      sigma.kill();
      sigmaRef.current = null;
      graphRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes]);

  // Keep current mode + filters available to the reducers without rebuilding sigma.
  const graphModeRef = useRef(graphMode);
  const graphFiltersRef = useRef(graphFilters);
  useEffect(() => {
    graphModeRef.current = graphMode;
  }, [graphMode]);
  useEffect(() => {
    graphFiltersRef.current = graphFilters;
    sigmaRef.current?.refresh({ skipIndexation: true });
  }, [graphFilters]);

  // Sync display refs from state.
  useEffect(() => {
    sizeScaleRef.current = graphDisplay.nodeSizeScale;
  }, [graphDisplay.nodeSizeScale]);
  useEffect(() => {
    travelerPaceRef.current = graphDisplay.travelerPace;
  }, [graphDisplay.travelerPace]);
  useEffect(() => {
    labelsEnabledRef.current = graphDisplay.labelsEnabled;
    sigmaRef.current?.refresh({ skipIndexation: true });
  }, [graphDisplay.labelsEnabled]);
  useEffect(() => {
    labelShowRatioRef.current = graphDisplay.labelShowRatio;
    sigmaRef.current?.refresh({ skipIndexation: true });
  }, [graphDisplay.labelShowRatio]);
  useEffect(() => {
    travelersEnabledRef.current = graphDisplay.travelersEnabled;
  }, [graphDisplay.travelersEnabled]);
  useEffect(() => {
    edgeThicknessRef.current = graphDisplay.edgeThickness;
    sigmaRef.current?.refresh({ skipIndexation: true });
  }, [graphDisplay.edgeThickness]);
  useEffect(() => {
    sigmaRef.current?.setSetting("labelSize", graphDisplay.labelSize);
    sigmaRef.current?.refresh({ skipIndexation: true });
  }, [graphDisplay.labelSize]);

  // Breathing lifecycle — owned here so the on/off toggle can mount and unmount
  // the rAF loop cleanly. Triggered by both the user toggle and the sigma
  // instance becoming available (sigmaReady).
  useEffect(() => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma || !graph) return;
    if (!graphDisplay.breathingEnabled) {
      stopBreathRef.current?.();
      stopBreathRef.current = null;
      // Restore non-breathing baseline so nodes don't freeze mid-pulse.
      graph.forEachNode((id) => {
        const base = (baseSizesRef.current.get(id) ?? 4) * sizeScaleRef.current;
        graph.setNodeAttribute(id, "size", base);
      });
      sigma.refresh({ skipIndexation: true });
      return;
    }
    stopBreathRef.current = startBreathing(
      sigma,
      graph,
      baseSizesRef.current,
      sizeScaleRef,
    );
    return () => {
      stopBreathRef.current?.();
      stopBreathRef.current = null;
    };
  }, [graphDisplay.breathingEnabled, sigmaReady]);

  // Repaint when the theme changes. Sigma re-reads node colors on refresh, so
  // we update attributes + settings in place — no need to recreate the
  // renderer. ``theme`` is read via the AppContext so a CSS var swap and the
  // React-side state change always happen together.
  useEffect(() => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma || !graph) return;
    paletteRef.current = applyPaletteToGraph(sigma, graph);
  }, [theme]);

  // Label threshold knob — feeds the zoom-tiered visibility floor in the
  // nodeReducer. Lower knob = more labels visible; higher = stricter.
  useEffect(() => {
    labelThresholdRef.current = graphDisplay.labelThreshold;
    sigmaRef.current?.refresh({ skipIndexation: true });
  }, [graphDisplay.labelThreshold]);

  // Spacing → camera zoom. Sigma 3 auto-fits the viewport to node bbox, so
  // scaling positions has no visual effect. Camera ratio gives the user the
  // perceived "tighter / spread out" change they expect.
  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    const ratio = spacingToCameraRatio(graphDisplay.spacingScale);
    sigma.getCamera().animate(
      { ratio, x: 0.5, y: 0.5 },
      { duration: 300, easing: easeInOutCubic },
    );
  }, [graphDisplay.spacingScale]);

  // Orbit auto-cycle: while the user is on the orbit screen, walk through a
  // curated set of layout "scenes" (Rings → Spiral → Arms → …) on a timer.
  // Constellation mode short-circuits to the force-directed layout as before.
  const [orbitScene, setOrbitScene] = useState<OrbitScene>("rings");
  const SCENE_HOLD_MS = 9000;
  const SCENE_TWEEN_MS = 1200;

  useEffect(() => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma || !graph) return;
    cancelAnimationFrame(tweenRafRef.current);

    const recenter = () => {
      const ratio = spacingToCameraRatio(graphDisplay.spacingScale);
      sigma.getCamera().animate(
        { ratio, x: 0.5, y: 0.5 },
        { duration: 600, easing: easeInOutCubic },
      );
    };

    if (graphMode !== "orbit") {
      basePositionsRef.current = applyConstellationLayout(graph);
      orbitTargetsRef.current = new Map();
      sigma.refresh();
      recenter();
      return;
    }

    const focusId = graphFocusId ?? notes[0]!.id;
    let sceneIdx = 0;
    let activeHandle: { cancel: () => void } | null = null;

    const playScene = (idx: number) => {
      const scene = ORBIT_SCENES[idx]!;
      setOrbitScene(scene);
      const targets = computeOrbitScene(graph, focusId, scene);
      orbitTargetsRef.current = targets;
      activeHandle?.cancel();
      activeHandle = startLayoutTween({
        sigma,
        graph,
        targets,
        duration: SCENE_TWEEN_MS,
        onComplete: recenter,
      });
    };

    playScene(sceneIdx);

    const interval = window.setInterval(() => {
      sceneIdx = (sceneIdx + 1) % ORBIT_SCENES.length;
      playScene(sceneIdx);
    }, SCENE_HOLD_MS);

    return () => {
      window.clearInterval(interval);
      activeHandle?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphMode, graphFocusId, notes]);

  const handleExport = useCallback(
    (format: ExportFormat) => {
      const sigma = sigmaRef.current;
      const graph = graphRef.current;
      if (!sigma || !graph) return;
      try {
        if (format === "png") {
          void exportGraphPng(sigma);
        } else if (format === "svg") {
          exportGraphSvg(sigma, graph);
        } else {
          exportGraphJson(graph);
        }
      } catch (err) {
        pushToast({
          icon: "⚠",
          agent: "sentinel",
          body: err instanceof Error ? err.message : "Export failed",
        });
      }
    },
    [pushToast],
  );

  return (
    <div className="graph-view">
      <GraphToolbar
        graphMode={graphMode}
        setGraphMode={setGraphMode}
        graphFilters={graphFilters}
        toggleGraphFilter={toggleGraphFilter}
        onExport={handleExport}
      />
      <div className="graph-canvas">
        <div ref={hostRef} className="sigma-container" />
        <svg
          ref={overlayRef}
          className="graph-travelers"
          width="100%"
          height="100%"
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: 4,
          }}
        />
        {graphMode === "orbit" && (
          <div className="graph-scene-caption" key={orbitScene}>
            <span className="graph-scene-kicker">Scene</span>
            <span className="graph-scene-name">
              {ORBIT_SCENE_LABELS[orbitScene]}
            </span>
          </div>
        )}
        <div className="graph-stats">
          {stats.nodes} nodes · {stats.edges} edges
        </div>
      </div>
    </div>
  );
}
