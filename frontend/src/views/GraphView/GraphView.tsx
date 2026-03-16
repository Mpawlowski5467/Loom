import ForceGraph2D from "react-force-graph-2d";
import type { ForceGraphMethods, NodeObject } from "react-force-graph-2d";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VaultGraph } from "../../lib/api";
import { fetchGraph } from "../../lib/api";
import { getCSSVar, getNodeColorsHex, TYPE_LABELS } from "../../lib/constants";
import { useApp } from "../../lib/context/useApp";
import styles from "./GraphView.module.css";

const POLL_INTERVAL = 10_000;

interface LoomNode {
  id: string;
  title: string;
  type: string;
  linkCount: number;
}

interface LoomLink {
  source: string;
  target: string;
}

interface GraphViewProps {
  activeFile: string | null;
  onFileSelect: (id: string) => void;
}

/** Node radius scales with connection count. */
function nodeRadius(n: NodeObject<LoomNode>): number {
  const count = n.linkCount ?? 0;
  return 4 + count * 1.5;
}

function getLinkId(link: LoomLink): { src: string; tgt: string } {
  const src = typeof link.source === "object" ? (link.source as LoomNode).id : link.source;
  const tgt = typeof link.target === "object" ? (link.target as LoomNode).id : link.target;
  return { src, tgt };
}

export function GraphView({ activeFile, onFileSelect }: GraphViewProps) {
  const { theme } = useApp();
  const fgRef = useRef<ForceGraphMethods<LoomNode, LoomLink>>(undefined);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // -- Theme-aware canvas colors (re-read when theme changes) ---------------
  const colors = useMemo(() => {
    const nodeHex = getNodeColorsHex();
    return {
      bg: getCSSVar("--graph-bg") || "#111318",
      label: getCSSVar("--graph-label") || "#8b90a0",
      labelBright: getCSSVar("--text-primary") || "#e2e5eb",
      edge: getCSSVar("--graph-edge") || "rgba(139,144,160,0.15)",
      edgeHover: getCSSVar("--graph-edge-hover") || "rgba(167,139,250,0.5)",
      selected: getCSSVar("--graph-selected") || "#f59e0b",
      dimmedNode: getCSSVar("--graph-dimmed") || "rgba(139,144,160,0.08)",
      dimmedEdge: getCSSVar("--graph-dimmed") || "rgba(139,144,160,0.04)",
      labelBg: theme === "light" ? "rgba(245,246,248,0.8)" : "rgba(17,19,24,0.75)",
      nodeHex,
      fallback: getCSSVar("--node-daily") || "#94a3b8",
    };
  }, [theme]);

  const [graphData, setGraphData] = useState<{ nodes: LoomNode[]; links: LoomLink[] }>({
    nodes: [],
    links: [],
  });
  const [filterType, setFilterType] = useState("all");
  const [stats, setStats] = useState({ nodes: 0, edges: 0 });
  const [loading, setLoading] = useState(true);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const dataRef = useRef<VaultGraph | null>(null);
  const hasZoomedRef = useRef(false);

  // -- Resize observer --------------------------------------------------------

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setDimensions({ width, height });
        }
      }
    });
    ro.observe(el);

    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setDimensions({ width: rect.width, height: rect.height });
    }

    return () => ro.disconnect();
  }, []);

  // -- Convert API data -------------------------------------------------------

  const convertData = useCallback((data: VaultGraph) => {
    const nodes: LoomNode[] = data.nodes.map((n) => ({
      id: n.id,
      title: n.title,
      type: n.type,
      linkCount: n.link_count,
    }));

    const nodeSet = new Set(nodes.map((n) => n.id));
    const links: LoomLink[] = data.edges
      .filter((e) => nodeSet.has(e.source) && nodeSet.has(e.target))
      .map((e) => ({ source: e.source, target: e.target }));

    return { nodes, links };
  }, []);

  // -- Load + poll ------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const data = await fetchGraph();
        if (cancelled) return;

        const prev = dataRef.current;
        if (
          prev &&
          prev.nodes.length === data.nodes.length &&
          prev.edges.length === data.edges.length &&
          prev.nodes.every(
            (n, i) => n.id === data.nodes[i]?.id && n.link_count === data.nodes[i]?.link_count,
          ) &&
          prev.edges.every(
            (e, i) => e.source === data.edges[i]?.source && e.target === data.edges[i]?.target,
          )
        ) {
          return;
        }

        dataRef.current = data;
        setStats({ nodes: data.nodes.length, edges: data.edges.length });
        setGraphData(convertData(data));
        setLoading(false);
      } catch (err) {
        console.error("Graph load failed:", err);
        setLoading(false);
      }
    };

    load();
    const interval = setInterval(load, POLL_INTERVAL);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [convertData]);

  // -- Zoom to fit once after first data load ---------------------------------

  useEffect(() => {
    if (graphData.nodes.length > 0 && fgRef.current && !hasZoomedRef.current) {
      hasZoomedRef.current = true;
      const timer = setTimeout(() => {
        fgRef.current?.zoomToFit(600, 80);
      }, 1800);
      return () => clearTimeout(timer);
    }
  }, [graphData.nodes.length]);

  // -- Center on active file --------------------------------------------------

  useEffect(() => {
    if (!activeFile || !fgRef.current) return;
    const node = graphData.nodes.find((n) => n.id === activeFile);
    if (node && (node as NodeObject<LoomNode>).x != null) {
      fgRef.current.centerAt(
        (node as NodeObject<LoomNode>).x,
        (node as NodeObject<LoomNode>).y,
        500,
      );
    }
  }, [activeFile, graphData.nodes]);

  // -- Filtered data ----------------------------------------------------------

  const filteredData = useMemo(() => {
    if (filterType === "all") return graphData;

    const visibleIds = new Set(
      graphData.nodes.filter((n) => n.type === filterType).map((n) => n.id),
    );
    return {
      nodes: graphData.nodes.filter((n) => visibleIds.has(n.id)),
      links: graphData.links.filter((l) => {
        const { src, tgt } = getLinkId(l);
        return visibleIds.has(src) && visibleIds.has(tgt);
      }),
    };
  }, [graphData, filterType]);

  // -- Neighbor set for hover dimming -----------------------------------------

  const neighborSet = useMemo(() => {
    if (!hoveredNode) return null;
    const set = new Set<string>();
    set.add(hoveredNode);
    for (const link of graphData.links) {
      const { src, tgt } = getLinkId(link);
      if (src === hoveredNode) set.add(tgt);
      if (tgt === hoveredNode) set.add(src);
    }
    return set;
  }, [hoveredNode, graphData.links]);

  // -- Custom node painting ---------------------------------------------------

  const paintNode = useCallback(
    (node: NodeObject<LoomNode>, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const id = node.id as string;
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const r = nodeRadius(node);
      const isSelected = id === activeFile;
      const isHovered = id === hoveredNode;
      const isDimmed = neighborSet !== null && !neighborSet.has(id);
      const color = colors.nodeHex[node.type ?? ""] ?? colors.fallback;

      // -- Draw node circle --
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);

      if (isDimmed) {
        ctx.fillStyle = colors.dimmedNode;
      } else {
        ctx.fillStyle = color;
        // Subtle glow for well-connected nodes
        if ((node.linkCount ?? 0) >= 4 && !isDimmed) {
          ctx.shadowColor = color;
          ctx.shadowBlur = 8;
        }
      }
      ctx.fill();
      ctx.shadowBlur = 0;

      // Selected: amber ring
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(x, y, r + 2, 0, 2 * Math.PI);
        ctx.strokeStyle = colors.selected;
        ctx.lineWidth = 2 / globalScale;
        ctx.stroke();
      }

      // Hovered: bright ring
      if (isHovered && !isSelected) {
        ctx.beginPath();
        ctx.arc(x, y, r + 1.5, 0, 2 * Math.PI);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5 / globalScale;
        ctx.stroke();
      }

      // -- Draw label --
      const showLabel =
        isSelected ||
        isHovered ||
        (neighborSet !== null && neighborSet.has(id) && !isDimmed) ||
        globalScale > 1.5 ||
        (globalScale > 0.8 && (node.linkCount ?? 0) >= 3);

      if (showLabel && !isDimmed) {
        const label = node.title ?? "";
        const baseFontSize = isHovered || isSelected ? 12 : 11;
        const fontSize = baseFontSize / globalScale;
        ctx.font = `500 ${fontSize}px Sora, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";

        // Text background for readability
        const metrics = ctx.measureText(label);
        const textWidth = metrics.width;
        const textHeight = fontSize;
        const pad = 2 / globalScale;
        ctx.fillStyle = colors.labelBg;
        ctx.fillRect(
          x - textWidth / 2 - pad,
          y + r + 2 / globalScale - pad / 2,
          textWidth + pad * 2,
          textHeight + pad,
        );

        // Text color
        if (isSelected) {
          ctx.fillStyle = colors.selected;
        } else if (isHovered) {
          ctx.fillStyle = colors.labelBright;
        } else {
          ctx.fillStyle = colors.label;
        }
        ctx.fillText(label, x, y + r + 2 / globalScale);
      }
    },
    [activeFile, hoveredNode, neighborSet, colors],
  );

  // -- Hit area for pointer ---------------------------------------------------

  const paintPointerArea = useCallback(
    (node: NodeObject<LoomNode>, color: string, ctx: CanvasRenderingContext2D) => {
      const r = nodeRadius(node) + 4;
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    },
    [],
  );

  // -- Link styling -----------------------------------------------------------

  const linkColorFn = useCallback(
    (link: LoomLink) => {
      if (!hoveredNode) return colors.edge;
      const { src, tgt } = getLinkId(link);
      if (src === hoveredNode || tgt === hoveredNode) return colors.edgeHover;
      return colors.dimmedEdge;
    },
    [hoveredNode, colors],
  );

  const linkWidthFn = useCallback(
    (link: LoomLink) => {
      if (!hoveredNode) return 0.6;
      const { src, tgt } = getLinkId(link);
      if (src === hoveredNode || tgt === hoveredNode) return 2;
      return 0.2;
    },
    [hoveredNode],
  );

  // -- Drag handlers ----------------------------------------------------------

  const handleNodeDrag = useCallback((node: NodeObject<LoomNode>) => {
    node.fx = node.x;
    node.fy = node.y;
  }, []);

  const handleNodeDragEnd = useCallback((node: NodeObject<LoomNode>) => {
    // Release so it can rejoin the simulation
    node.fx = undefined;
    node.fy = undefined;
  }, []);

  // -- Render -----------------------------------------------------------------

  return (
    <div className={styles.wrap} ref={wrapRef}>
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

      <ForceGraph2D
        ref={fgRef}
        width={dimensions.width}
        height={dimensions.height}
        graphData={filteredData}
        backgroundColor={colors.bg}
        // Node rendering
        nodeCanvasObject={paintNode}
        nodePointerAreaPaint={paintPointerArea}
        // Link rendering
        linkColor={linkColorFn}
        linkWidth={linkWidthFn}
        // Interactions
        onNodeClick={(node) => {
          if (node.id) onFileSelect(node.id as string);
        }}
        onNodeHover={(node) => {
          setHoveredNode((node?.id as string) ?? null);
        }}
        onNodeDrag={handleNodeDrag}
        onNodeDragEnd={handleNodeDragEnd}
        onBackgroundClick={() => {
          setHoveredNode(null);
        }}
        enableNodeDrag={true}
        enableZoomInteraction={true}
        enablePanInteraction={true}
        // d3-force tuning
        cooldownTicks={200}
        cooldownTime={5000}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.3}
        // Zoom range
        minZoom={0.2}
        maxZoom={12}
      />

      <div className={styles.stats}>
        {stats.nodes} nodes &middot; {stats.edges} edges
      </div>

      <div className={styles.controls}>
        <button
          className={styles.controlBtn}
          title="Zoom to fit"
          onClick={() => fgRef.current?.zoomToFit(400, 60)}
        >
          Fit
        </button>
        <button
          className={styles.controlBtn}
          title="Zoom in"
          onClick={() => {
            const z = fgRef.current?.zoom() ?? 1;
            fgRef.current?.zoom(z * 1.5, 300);
          }}
        >
          +
        </button>
        <button
          className={styles.controlBtn}
          title="Zoom out"
          onClick={() => {
            const z = fgRef.current?.zoom() ?? 1;
            fgRef.current?.zoom(z / 1.5, 300);
          }}
        >
          -
        </button>
      </div>
    </div>
  );
}
