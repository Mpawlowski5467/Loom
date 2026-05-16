import { useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import type Graph from "graphology";
import type Sigma from "sigma";
import { useApp } from "../context/app-ctx";
import type { NodeType } from "../data/types";
import { ModeToggle } from "../components/primitives/ModeToggle";
import { startBreathing } from "../graph/breathing";
import {
  applyConstellationLayout,
  computeOrbitLayout,
  easeInOutCubic,
} from "../graph/layouts";
import { buildGraph, createSigma } from "../graph/sigma-setup";

const TYPE_FILTERS: { type: NodeType; label: string }[] = [
  { type: "project", label: "project" },
  { type: "topic", label: "topic" },
  { type: "people", label: "people" },
  { type: "daily", label: "daily" },
  { type: "capture", label: "capture" },
  { type: "custom", label: "custom" },
];

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
  } = useApp();

  const hostRef = useRef<HTMLDivElement | null>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const hoveredRef = useRef<string | null>(null);
  const baseSizesRef = useRef<Map<string, number>>(new Map());
  const stopBreathRef = useRef<(() => void) | null>(null);
  const tweenRafRef = useRef<number>(0);

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
    applyConstellationLayout(graph);

    const sigma = createSigma(graph, hostRef.current);
    sigmaRef.current = sigma;

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
      return { ...data, color: "rgba(140,135,125,0.18)", label: "" };
    });

    sigma.setSetting("edgeReducer", (id, data) => {
      const hovered = hoveredRef.current;
      if (!hovered) return data;
      const ext = graph.extremities(id);
      if (ext[0] === hovered || ext[1] === hovered) {
        return { ...data, color: "rgba(168,58,44,0.55)", size: 1.4 };
      }
      return { ...data, color: "rgba(26,24,21,0.05)" };
    });

    sigma.on("enterNode", ({ node }) => {
      hoveredRef.current = node;
      sigma.refresh({ skipIndexation: true });
    });
    sigma.on("leaveNode", () => {
      hoveredRef.current = null;
      sigma.refresh({ skipIndexation: true });
    });
    sigma.on("clickNode", ({ node }) => {
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

    stopBreathRef.current = startBreathing(sigma, graph, baseSizes);

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

  // Orbit transition: tween positions from current to computed targets.
  useEffect(() => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma || !graph) return;
    cancelAnimationFrame(tweenRafRef.current);

    const targets =
      graphMode === "orbit"
        ? computeOrbitLayout(graph, graphFocusId ?? notes[0]!.id)
        : null;

    if (!targets) {
      applyConstellationLayout(graph);
      sigma.refresh();
      sigma.getCamera().animatedReset({ duration: 600 });
      return;
    }

    const starts = new Map<string, { x: number; y: number }>();
    graph.forEachNode((id, attrs) => {
      starts.set(id, { x: attrs["x"] as number, y: attrs["y"] as number });
    });

    const duration = 700;
    const t0 = performance.now();
    const step = () => {
      const p = Math.min(1, (performance.now() - t0) / duration);
      const eased = easeInOutCubic(p);
      graph.forEachNode((id) => {
        const s = starts.get(id);
        const tgt = targets.get(id);
        if (!s || !tgt) return;
        graph.setNodeAttribute(id, "x", s.x + (tgt.x - s.x) * eased);
        graph.setNodeAttribute(id, "y", s.y + (tgt.y - s.y) * eased);
      });
      sigma.refresh({ skipIndexation: true });
      if (p < 1) {
        tweenRafRef.current = requestAnimationFrame(step);
      } else {
        sigma.refresh();
        sigma.getCamera().animatedReset({ duration: 600 });
      }
    };
    tweenRafRef.current = requestAnimationFrame(step);

    return () => cancelAnimationFrame(tweenRafRef.current);
  }, [graphMode, graphFocusId, notes]);

  return (
    <div className="graph-view">
      <div className="graph-toolbar">
        <div className="graph-filters" role="group" aria-label="Filter by type">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.type}
              className="graph-filter"
              aria-pressed={graphFilters.has(f.type)}
              onClick={() => toggleGraphFilter(f.type)}
            >
              <span className={`dot dot-${f.type}`} />
              {f.label}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: "auto" }}>
          <ModeToggle
            value={graphMode}
            onChange={setGraphMode}
            ariaLabel="Graph layout"
            options={[
              { value: "constellation", icon: "✦", label: "constellation" },
              { value: "orbit", icon: "◎", label: "orbit" },
            ]}
          />
        </div>
      </div>
      <div className="graph-canvas">
        <div ref={hostRef} className="sigma-container" />
        <div className="graph-stats">
          {stats.nodes} nodes · {stats.edges} edges
        </div>
      </div>
    </div>
  );
}
