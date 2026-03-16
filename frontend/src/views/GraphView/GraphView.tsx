import Graph from "graphology";
import Sigma from "sigma";
import { useEffect, useRef, useState } from "react";
import type { VaultGraph } from "../../lib/api";
import { fetchGraph } from "../../lib/api";
import { NODE_COLORS_HEX, TYPE_LABELS } from "../../lib/constants";
import {
  startLayout,
  killLayout,
  restartLayout,
  zoomToFit,
  setupEvents,
  selectExternalNode,
  startBreathing,
  createNodeReducer,
  createEdgeReducer,
  updateGraph,
  BASE_NODE_SIZE,
  SIZE_SCALE,
} from "../../lib/graph";
import styles from "./GraphView.module.css";

const POLL_INTERVAL = 10_000;

interface GraphViewProps {
  activeFile: string | null;
  onFileSelect: (id: string) => void;
}

export function GraphView({ activeFile, onFileSelect }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const supervisorRef = useRef<ReturnType<typeof startLayout> | null>(null);
  const dataRef = useRef<VaultGraph | null>(null);

  const hoveredNode = useRef<string | null>(null);
  const draggedNode = useRef<string | null>(null);
  const pinnedNodes = useRef<Set<string>>(new Set());
  const selectedNode = useRef<string | null>(null);
  const onFileSelectRef = useRef(onFileSelect);
  onFileSelectRef.current = onFileSelect;

  const [filterType, setFilterType] = useState("all");
  const [stats, setStats] = useState({ nodes: 0, edges: 0 });
  const [loading, setLoading] = useState(true);

  const filterRef = useRef(filterType);
  filterRef.current = filterType;

  const stopBreathingRef = useRef<(() => void) | null>(null);

  // -- Build graph from API data -----------------------------------------------

  function buildGraph(data: VaultGraph): Graph {
    const g = new Graph();

    for (const n of data.nodes) {
      g.addNode(n.id, {
        label: n.title,
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: BASE_NODE_SIZE + n.link_count * SIZE_SCALE,
        color: NODE_COLORS_HEX[n.type] ?? "#94a3b8",
        noteType: n.type,
        pinned: false,
      });
    }

    for (const e of data.edges) {
      if (g.hasNode(e.source) && g.hasNode(e.target)) {
        try {
          g.addEdge(e.source, e.target, { weight: 1 });
        } catch {
          /* duplicate */
        }
      }
    }

    // Shared-neighbor edge weights
    g.forEachEdge((edge, _attrs, source, target) => {
      const sn = new Set(g.neighbors(source));
      let shared = 0;
      for (const tn of g.neighbors(target)) if (sn.has(tn)) shared++;
      g.setEdgeAttribute(edge, "weight", 1 + shared);
    });

    return g;
  }

  // -- Initialize Sigma --------------------------------------------------------

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    // Guard StrictMode double-mount
    if (sigmaRef.current) {
      killLayout(supervisorRef.current);
      supervisorRef.current = null;
      sigmaRef.current.kill();
      sigmaRef.current = null;
      graphRef.current = null;
    }

    let cancelled = false;

    fetchGraph()
      .then((data) => {
        if (cancelled) return;

        dataRef.current = data;
        setStats({ nodes: data.nodes.length, edges: data.edges.length });
        setLoading(false);

        const graph = buildGraph(data);
        graphRef.current = graph;

        const reducerRefs = {
          graph: graphRef,
          filterType: filterRef,
          hoveredNode,
          selectedNode,
          pinnedNodes,
        };

        const renderer = new Sigma(graph, container, {
          labelFont: '"Sora", sans-serif',
          labelSize: 12,
          labelColor: { color: "#94a3b8" },
          labelDensity: 1.5,
          labelRenderedSizeThreshold: 4,
          defaultEdgeColor: "rgba(148,163,184,0.12)",
          stagePadding: 40,
          minEdgeThickness: 0.5,
          zIndex: true,
          nodeReducer: createNodeReducer(reducerRefs),
          edgeReducer: createEdgeReducer(reducerRefs),
        });

        sigmaRef.current = renderer;

        // Start layout with convergence detection
        supervisorRef.current = startLayout(graph);

        // Zoom to fit after a short delay (let layout settle)
        setTimeout(() => {
          if (!cancelled && sigmaRef.current && graphRef.current) {
            zoomToFit(sigmaRef.current, graphRef.current);
          }
        }, 1200);

        // Wire events
        const cleanupEvents = setupEvents({
          graph,
          sigma: renderer,
          supervisor: supervisorRef.current,
          hoveredNode,
          draggedNode,
          pinnedNodes,
          selectedNode,
          onFileSelect: onFileSelectRef,
        });

        // Start breathing animation
        stopBreathingRef.current = startBreathing(graph, renderer);

        // Store event cleanup for teardown
        (renderer as unknown as Record<string, unknown>).__cleanupEvents = cleanupEvents;

        // Apply activeFile if set on mount
        if (activeFile) {
          selectedNode.current = activeFile;
        }
      })
      .catch((err: Error) => {
        setLoading(false);
        console.error("Graph load failed:", err);
      });

    return () => {
      cancelled = true;
      stopBreathingRef.current?.();
      stopBreathingRef.current = null;
      const renderer = sigmaRef.current;
      if (renderer) {
        const cleanup = (renderer as unknown as Record<string, unknown>).__cleanupEvents as (() => void) | undefined;
        cleanup?.();
      }
      killLayout(supervisorRef.current);
      supervisorRef.current = null;
      sigmaRef.current?.kill();
      sigmaRef.current = null;
      graphRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -- React to activeFile changes from sidebar --------------------------------

  useEffect(() => {
    if (sigmaRef.current && graphRef.current) {
      selectExternalNode(sigmaRef.current, graphRef.current, selectedNode, activeFile);
    }
  }, [activeFile]);

  // -- Filter change -----------------------------------------------------------

  useEffect(() => {
    sigmaRef.current?.scheduleRefresh();
  }, [filterType]);

  // -- Polling -----------------------------------------------------------------

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const data = await fetchGraph();
        const prev = dataRef.current;

        if (
          prev &&
          prev.nodes.length === data.nodes.length &&
          prev.edges.length === data.edges.length &&
          prev.nodes.every((n, i) => n.id === data.nodes[i]?.id && n.link_count === data.nodes[i]?.link_count) &&
          prev.edges.every((e, i) => e.source === data.edges[i]?.source && e.target === data.edges[i]?.target)
        ) {
          return;
        }

        dataRef.current = data;
        setStats({ nodes: data.nodes.length, edges: data.edges.length });

        const graph = graphRef.current;
        if (!graph) return;

        const changed = updateGraph(data, graph);
        if (changed) {
          // Restart layout so new nodes find their positions
          supervisorRef.current = restartLayout(graph, supervisorRef.current);
          sigmaRef.current?.scheduleRefresh();
        }
      } catch {
        /* silent */
      }
    }, POLL_INTERVAL);

    return () => clearInterval(interval);
  }, []);

  // -- Render ------------------------------------------------------------------

  return (
    <div className={styles.wrap}>
      {loading && <div className={styles.loading}>Loading graph...</div>}

      <div className={styles.filters}>
        {TYPE_LABELS.map((t) => (
          <button
            key={t.id}
            className={`${styles.chip}${filterType === t.id ? ` ${styles.chipActive}` : ""}`}
            onClick={() => setFilterType(t.id)}
          >
            {t.color && <span className={styles.chipDot} style={{ backgroundColor: t.color }} />}
            {t.label}
          </button>
        ))}
      </div>

      <div ref={containerRef} className={styles.container} />

      <div className={styles.stats}>
        {stats.nodes} nodes &middot; {stats.edges} edges
      </div>
    </div>
  );
}
