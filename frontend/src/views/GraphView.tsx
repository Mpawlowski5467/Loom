import { useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import type Graph from "graphology";
import type Sigma from "sigma";
import { useApp } from "../context/app-ctx";
import { GraphToolbar } from "../components/graph/GraphToolbar";
import { startBreathing } from "../graph/breathing";
import {
  applyConstellationLayout,
  computeOrbitLayout,
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
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const hoveredRef = useRef<string | null>(null);
  const baseSizesRef = useRef<Map<string, number>>(new Map());
  const stopBreathRef = useRef<(() => void) | null>(null);
  const tweenRafRef = useRef<number>(0);
  const paletteRef = useRef<EdgePalette>(readEdgePalette());

  const sizeScaleRef = useRef<number>(graphDisplay.nodeSizeScale);
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
    sigma.setSetting(
      "labelRenderedSizeThreshold",
      graphDisplay.labelThreshold,
    );
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
      if (!hovered) return data;
      if (id === hovered) return data;
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

    return () => {
      clearTimeout(reset);
      ro.disconnect();
      stopBreathRef.current?.();
      detachDrag();
      cancelAnimationFrame(tweenRafRef.current);
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
    sigma.getCamera().animate(
      { ratio, x: 0.5, y: 0.5 },
      { duration: 300 },
    );
  }, [graphDisplay.spacingScale]);

  // Mode/focus transitions: tween between constellation and orbit layouts.
  useEffect(() => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma || !graph) return;
    cancelAnimationFrame(tweenRafRef.current);

    const targets: Map<string, XY> | null =
      graphMode === "orbit"
        ? computeOrbitLayout(graph, graphFocusId ?? notes[0]!.id)
        : null;

    const recenter = () => {
      const ratio = spacingToCameraRatio(graphDisplay.spacingScale);
      sigma.getCamera().animate({ ratio, x: 0.5, y: 0.5 }, { duration: 600 });
    };

    if (!targets) {
      basePositionsRef.current = applyConstellationLayout(graph);
      orbitTargetsRef.current = new Map();
      sigma.refresh();
      recenter();
      return;
    }

    orbitTargetsRef.current = targets;
    const handle = startLayoutTween({
      sigma,
      graph,
      targets,
      onComplete: recenter,
    });
    return () => handle.cancel();
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
        <div className="graph-stats">
          {stats.nodes} nodes · {stats.edges} edges
        </div>
      </div>
    </div>
  );
}
