import Graph from "graphology";
import FA2LayoutSupervisor from "graphology-layout-forceatlas2/worker";
import Sigma from "sigma";
import { useCallback, useEffect, useRef, useState } from "react";
import type { VaultGraph } from "../../lib/api";
import { fetchGraph } from "../../lib/api";
import { NODE_COLORS_HEX, TYPE_LABELS } from "../../lib/constants";
import styles from "./GraphView.module.css";

const BASE_NODE_SIZE = 6;
const SIZE_SCALE = 2.5;
const EDGE_COLOR = "rgba(148,163,184,0.12)";
const EDGE_COLOR_HEAVY = "rgba(167,139,250,0.2)";
const POLL_INTERVAL = 10_000;

// -- Props --------------------------------------------------------------------

interface GraphViewProps {
  activeFile: string | null;
  onFileSelect: (path: string) => void;
}

// -- Component ----------------------------------------------------------------

export function GraphView({ onFileSelect }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const supervisorRef = useRef<FA2LayoutSupervisor | null>(null);
  const dataRef = useRef<VaultGraph | null>(null);

  // Interaction state stored in refs so reducers pick up latest without re-render
  const hoveredNode = useRef<string | null>(null);
  const draggedNode = useRef<string | null>(null);
  const pinnedNodes = useRef<Set<string>>(new Set());

  const [filterType, setFilterType] = useState("all");
  const [stats, setStats] = useState({ nodes: 0, edges: 0 });
  const [loading, setLoading] = useState(true);

  // We need a ref to filterType so reducers can read it without stale closures
  const filterRef = useRef(filterType);
  filterRef.current = filterType;

  // -- Build / update graph from API data -----------------------------------

  const buildGraph = useCallback((data: VaultGraph): Graph => {
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
          // duplicate edge — skip
        }
      }
    }

    // Compute edge weight based on shared-neighbor density
    g.forEachEdge((edge, _attrs, source, target) => {
      const sNeighbors = new Set(g.neighbors(source));
      let shared = 0;
      for (const tn of g.neighbors(target)) {
        if (sNeighbors.has(tn)) shared++;
      }
      g.setEdgeAttribute(edge, "weight", 1 + shared);
    });

    return g;
  }, []);

  const updateGraphData = useCallback(
    (data: VaultGraph, existing: Graph): boolean => {
      const existingIds = new Set(existing.nodes());
      const newIds = new Set(data.nodes.map((n) => n.id));

      let changed = false;

      // Remove nodes that no longer exist
      for (const id of existingIds) {
        if (!newIds.has(id)) {
          existing.dropNode(id);
          changed = true;
        }
      }

      // Add new nodes
      for (const n of data.nodes) {
        if (!existing.hasNode(n.id)) {
          existing.addNode(n.id, {
            label: n.title,
            x: Math.random() * 100,
            y: Math.random() * 100,
            size: BASE_NODE_SIZE + n.link_count * SIZE_SCALE,
            color: NODE_COLORS_HEX[n.type] ?? "#94a3b8",
            noteType: n.type,
            pinned: false,
          });
          changed = true;
        } else {
          // Update attributes on existing nodes (preserve x, y, pinned)
          const cur = existing.getNodeAttributes(n.id);
          existing.mergeNodeAttributes(n.id, {
            label: n.title,
            size: BASE_NODE_SIZE + n.link_count * SIZE_SCALE,
            color: NODE_COLORS_HEX[n.type] ?? "#94a3b8",
            noteType: n.type,
            pinned: cur.pinned,
          });
        }
      }

      // Rebuild edges
      const existingEdges = new Set<string>();
      existing.forEachEdge((_e, _a, s, t) => existingEdges.add(`${s}->${t}`));
      const newEdges = new Set(data.edges.map((e) => `${e.source}->${e.target}`));

      // Remove stale edges
      existing.forEachEdge((edge, _attrs, source, target) => {
        if (!newEdges.has(`${source}->${target}`)) {
          existing.dropEdge(edge);
          changed = true;
        }
      });

      // Add new edges
      for (const e of data.edges) {
        if (
          !existingEdges.has(`${e.source}->${e.target}`) &&
          existing.hasNode(e.source) &&
          existing.hasNode(e.target)
        ) {
          try {
            existing.addEdge(e.source, e.target, { weight: 1 });
            changed = true;
          } catch {
            // skip duplicates
          }
        }
      }

      return changed;
    },
    [],
  );

  // -- Initialize Sigma + FA2 ------------------------------------------------

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;

    // Guard against StrictMode double-mount: kill previous instance
    if (sigmaRef.current) {
      supervisorRef.current?.kill();
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

        const renderer = new Sigma(graph, container, {
          labelFont: '"Sora", sans-serif',
          labelSize: 12,
          labelColor: { color: "#94a3b8" },
          labelDensity: 1.5,
          labelRenderedSizeThreshold: 4,
          defaultEdgeColor: EDGE_COLOR,
          stagePadding: 40,
          minEdgeThickness: 0.5,
          zIndex: true,
          nodeReducer: (node, data) => {
            const res = { ...data };
            const ft = filterRef.current;
            const hovered = hoveredNode.current;

            // Filter
            if (ft !== "all" && data.noteType !== ft) {
              res.hidden = true;
              return res;
            }

            // Hover dimming
            if (hovered && hovered !== node) {
              const g = graphRef.current;
              if (g && !g.neighbors(hovered).includes(node)) {
                res.color = "rgba(148,163,184,0.08)";
                res.label = null;
              }
            }

            // Highlight hovered node
            if (hovered === node) {
              res.highlighted = true;
              res.zIndex = 10;
            }

            // Pinned indicator: slightly larger
            if (pinnedNodes.current.has(node)) {
              res.size = (res.size ?? BASE_NODE_SIZE) + 2;
            }

            return res;
          },
          edgeReducer: (edge, data) => {
            const res = { ...data };
            const ft = filterRef.current;
            const g = graphRef.current;

            if (!g) return res;

            const source = g.source(edge);
            const target = g.target(edge);

            // Filter: hide edges to hidden nodes
            if (ft !== "all") {
              const sType = g.getNodeAttribute(source, "noteType");
              const tType = g.getNodeAttribute(target, "noteType");
              if (sType !== ft || tType !== ft) {
                res.hidden = true;
                return res;
              }
            }

            // Edge weight → thickness
            const weight = g.getEdgeAttribute(edge, "weight") ?? 1;
            res.size = Math.min(0.5 + weight * 0.8, 4);
            res.color = weight > 2 ? EDGE_COLOR_HEAVY : EDGE_COLOR;

            // Hover: dim edges not connected to hovered node
            const hovered = hoveredNode.current;
            if (hovered) {
              if (source !== hovered && target !== hovered) {
                res.hidden = true;
              } else {
                res.color = "rgba(167,139,250,0.4)";
                res.size = Math.max(res.size ?? 1, 1.5);
              }
            }

            return res;
          },
        });

        sigmaRef.current = renderer;

        // -- Force layout ---------------------------------------------------
        const supervisor = new FA2LayoutSupervisor(graph, {
          settings: {
            gravity: 10,
            scalingRatio: 5,
            slowDown: 20,
            barnesHutOptimize: true,
            barnesHutTheta: 0.5,
            strongGravityMode: true,
          },
        });
        supervisorRef.current = supervisor;
        supervisor.start();

        // Stop layout after it settles
        setTimeout(() => {
          if (!cancelled && supervisorRef.current?.isRunning()) {
            supervisorRef.current.stop();
          }
        }, 2500);

        // -- Hover events ---------------------------------------------------
        renderer.on("enterNode", ({ node }) => {
          hoveredNode.current = node;
          renderer.scheduleRefresh();
        });

        renderer.on("leaveNode", () => {
          hoveredNode.current = null;
          renderer.scheduleRefresh();
        });

        // -- Drag events ----------------------------------------------------
        renderer.on("downNode", (e) => {
          draggedNode.current = e.node;
          // Stop layout during drag
          if (supervisorRef.current?.isRunning()) {
            supervisorRef.current.stop();
          }
          // Fix node so layout doesn't move it
          graph.setNodeAttribute(e.node, "fixed", true);
          // Prevent camera pan while dragging
          e.preventSigmaDefault();
        });

        renderer.getMouseCaptor().on("mousemovebody", (e) => {
          if (!draggedNode.current) return;
          const pos = renderer.viewportToGraph(e);
          graph.setNodeAttribute(draggedNode.current, "x", pos.x);
          graph.setNodeAttribute(draggedNode.current, "y", pos.y);
        });

        renderer.getMouseCaptor().on("mouseup", () => {
          if (draggedNode.current) {
            if (!pinnedNodes.current.has(draggedNode.current)) {
              graph.setNodeAttribute(draggedNode.current, "fixed", false);
            }
            draggedNode.current = null;
          }
        });

        // -- Double-click to pin/unpin ------------------------------------
        renderer.on("doubleClickNode", (e) => {
          e.preventSigmaDefault();
          const node = e.node;
          if (pinnedNodes.current.has(node)) {
            pinnedNodes.current.delete(node);
            graph.setNodeAttribute(node, "pinned", false);
            graph.setNodeAttribute(node, "fixed", false);
          } else {
            pinnedNodes.current.add(node);
            graph.setNodeAttribute(node, "pinned", true);
            graph.setNodeAttribute(node, "fixed", true);
          }
          renderer.scheduleRefresh();
        });

        // -- Click to select note -----------------------------------------
        renderer.on("clickNode", ({ node }) => {
          // Don't fire click after drag
          if (draggedNode.current) return;
          onFileSelect(node);
        });
      })
      .catch((err: Error) => {
        setLoading(false);
        console.error("Graph load failed:", err);
      });

    return () => {
      cancelled = true;
      supervisorRef.current?.kill();
      supervisorRef.current = null;
      sigmaRef.current?.kill();
      sigmaRef.current = null;
      graphRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -- Filter change → refresh reducers -------------------------------------

  useEffect(() => {
    sigmaRef.current?.scheduleRefresh();
  }, [filterType]);

  // -- Auto-refresh (poll every 10s) ----------------------------------------

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const data = await fetchGraph();
        const prev = dataRef.current;

        // Quick equality check
        if (
          prev &&
          JSON.stringify(prev.nodes) === JSON.stringify(data.nodes) &&
          JSON.stringify(prev.edges) === JSON.stringify(data.edges)
        ) {
          return;
        }

        dataRef.current = data;
        setStats({ nodes: data.nodes.length, edges: data.edges.length });

        if (graphRef.current) {
          const changed = updateGraphData(data, graphRef.current);
          if (changed) {
            sigmaRef.current?.scheduleRefresh();
          }
        }
      } catch {
        // Silently ignore poll errors
      }
    }, POLL_INTERVAL);

    return () => clearInterval(interval);
  }, [updateGraphData]);

  // -- Render -----------------------------------------------------------------

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
            {t.color && (
              <span
                className={styles.chipDot}
                style={{ backgroundColor: t.color }}
              />
            )}
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
