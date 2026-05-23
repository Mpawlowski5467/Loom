import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type Graph from "graphology";
import type Sigma from "sigma";
import { useApp } from "../context/app-ctx";
import { GraphToolbar } from "../components/graph/GraphToolbar";
import { startBreathing } from "../graph/breathing";
import {
  applyConstellationLayout,
  computeOrbitScene,
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

    const sigma = createSigma(graph, hostRef.current);
    sigma.setSetting("labelRenderedSizeThreshold", graphDisplay.labelThreshold);
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
      const lensHide = id === lensLabelHideForRef.current;
      if (!hovered) return lensHide ? { ...data, label: "" } : data;
      if (id === hovered) return lensHide ? { ...data, label: "" } : data;
      const isNeighbor =
        graph.hasEdge(hovered, id) || graph.hasEdge(id, hovered);
      if (isNeighbor) return { ...data, label: "" };
      return { ...data, color: paletteRef.current.nodeDimmed, label: "" };
    });

    sigma.setSetting("edgeReducer", (id, data) => {
      const hovered = hoveredRef.current;
      if (!hovered) return data;
      const ext = graph.extremities(id);
      if (ext[0] === hovered || ext[1] === hovered) {
        return { ...data, color: paletteRef.current.edgeHover, size: 1.4 };
      }
      return { ...data, color: paletteRef.current.edgeFaint };
    });

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

    stopBreathRef.current = startBreathing(
      sigma,
      graph,
      baseSizes,
      sizeScaleRef,
    );

    const ro = new ResizeObserver(() => {
      sigma.resize();
      sigma.refresh();
    });
    ro.observe(hostRef.current);

    const reset = setTimeout(() => {
      sigma.getCamera().animatedReset({ duration: 600 });
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
      const lines: typeof travelerLinesRef.current = [];
      graph.forEachEdge((_edgeId, _attr, source, target) => {
        const line = document.createElementNS(SVG_NS, "line");
        line.setAttribute("stroke", "#2d4a7c");
        line.setAttribute("stroke-width", "2.0");
        line.setAttribute("stroke-linecap", "round");
        line.setAttribute("opacity", "0.92");
        overlay.appendChild(line);
        lines.push({ el: line, s: source, t: target });
      });
      travelerLinesRef.current = lines;

      // Lens DOM (built once per effect; siblings after the travelers so it
      // paints on top in z-order).
      const defs = document.createElementNS(SVG_NS, "defs");
      const clipId = `loom-lens-clip-${Math.random().toString(36).slice(2, 9)}`;
      const clipPath = document.createElementNS(SVG_NS, "clipPath");
      clipPath.setAttribute("id", clipId);
      const clipCircle = document.createElementNS(SVG_NS, "circle");
      clipCircle.setAttribute("r", "0");
      clipPath.appendChild(clipCircle);
      defs.appendChild(clipPath);
      overlay.appendChild(defs);

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
    const tickTravelers = () => {
      const lines = travelerLinesRef.current;
      const hovered = hoveredRef.current;
      const filters = graphFiltersRef.current;
      const pace = travelerPaceRef.current;
      const now = performance.now();
      for (let i = 0; i < lines.length; i++) {
        const { el, s, t } = lines[i]!;

        if (pace <= 0) {
          el.setAttribute("opacity", "0");
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
          el.setAttribute("opacity", "0");
          continue;
        }
        const ux = dx / len;
        const uy = dy / len;
        const phase = ((now / 1000) * BASE_SPEED * pace + i * 0.1) % 1;
        const segStart = Math.max(0, phase * len - SEG_LEN / 2);
        const segEnd = Math.min(len, phase * len + SEG_LEN / 2);
        el.setAttribute("x1", String(p1.x + ux * segStart));
        el.setAttribute("y1", String(p1.y + uy * segStart));
        el.setAttribute("x2", String(p1.x + ux * segEnd));
        el.setAttribute("y2", String(p1.y + uy * segEnd));

        if (filters.size > 0) {
          const sType = graph.getNodeAttribute(s, "noteType") as string;
          const tType = graph.getNodeAttribute(t, "noteType") as string;
          if (!filters.has(sType) || !filters.has(tType)) {
            el.setAttribute("opacity", "0");
            continue;
          }
        }

        if (hovered) {
          const incident = s === hovered || t === hovered;
          el.setAttribute("opacity", incident ? "0.92" : "0.15");
          el.setAttribute("stroke-width", incident ? "2.4" : "2.0");
        } else {
          el.setAttribute("opacity", "0.92");
          el.setAttribute("stroke-width", "2.0");
        }
      }

      // --- Lens --------------------------------------------------------------
      // Pick the focused node: nearest to viewport center (skipping filtered).
      const host = hostRef.current;
      const lensG = lensGroupRef.current;
      if (host && lensG) {
        const w = host.clientWidth;
        const h = host.clientHeight;
        const centerGraph = sigma.viewportToGraph({ x: w / 2, y: h / 2 });
        let nearest: string | null = null;
        let bestDist = Infinity;
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
            nearest = id;
          }
        });

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

  // Label threshold — runtime sigma setting.
  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    sigma.setSetting("labelRenderedSizeThreshold", graphDisplay.labelThreshold);
    sigma.refresh({ skipIndexation: true });
  }, [graphDisplay.labelThreshold]);

  // Spacing → camera zoom. Sigma 3 auto-fits the viewport to node bbox, so
  // scaling positions has no visual effect. Camera ratio gives the user the
  // perceived "tighter / spread out" change they expect.
  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    const ratio = spacingToCameraRatio(graphDisplay.spacingScale);
    sigma.getCamera().animate({ ratio, x: 0.5, y: 0.5 }, { duration: 300 });
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
      sigma.getCamera().animate({ ratio, x: 0.5, y: 0.5 }, { duration: 600 });
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

  return (
    <div className="graph-view">
      <GraphToolbar
        graphMode={graphMode}
        setGraphMode={setGraphMode}
        graphFilters={graphFilters}
        toggleGraphFilter={toggleGraphFilter}
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
