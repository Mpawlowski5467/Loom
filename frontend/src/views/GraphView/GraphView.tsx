import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import type { ForceGraphMethods, NodeObject } from "react-force-graph-2d";
import { fetchGraphConditional, type VaultGraph } from "../../lib/api";
import { useApp } from "../../lib/context/useApp";
import { GraphControls } from "./GraphControls";
import { GraphFilters } from "./GraphFilters";
import styles from "./GraphView.module.css";
import { paintNode, paintPointerArea } from "./paintNode";
import { POLL_INTERVAL, getLinkId, type LoomLink, type LoomNode } from "./types";
import { useGraphColors } from "./useGraphColors";

interface GraphViewProps {
  activeFile: string | null;
  onFileSelect: (id: string) => void;
}

export function GraphView({ activeFile, onFileSelect }: GraphViewProps) {
  const { theme } = useApp();
  const fgRef = useRef<ForceGraphMethods<LoomNode, LoomLink>>(undefined);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  const colors = useGraphColors(theme);

  const [graphData, setGraphData] = useState<{ nodes: LoomNode[]; links: LoomLink[] }>({
    nodes: [],
    links: [],
  });
  const [filterType, setFilterType] = useState("all");
  const [stats, setStats] = useState({ nodes: 0, edges: 0 });
  const [loading, setLoading] = useState(true);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const dataRef = useRef<VaultGraph | null>(null);
  const lastEtagRef = useRef<string | null>(null);
  const hasZoomedRef = useRef(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) setDimensions({ width, height });
      }
    });
    ro.observe(el);

    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setDimensions({ width: rect.width, height: rect.height });
    }

    return () => ro.disconnect();
  }, []);

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

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const { data, etag } = await fetchGraphConditional(lastEtagRef.current);
        if (cancelled) return;

        lastEtagRef.current = etag;
        if (data === null) return;

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

  useEffect(() => {
    if (graphData.nodes.length > 0 && fgRef.current && !hasZoomedRef.current) {
      hasZoomedRef.current = true;
      const timer = setTimeout(() => {
        fgRef.current?.zoomToFit(600, 80);
      }, 1800);
      return () => clearTimeout(timer);
    }
  }, [graphData.nodes.length]);

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

  const nodeCanvasObject = useCallback(
    (node: NodeObject<LoomNode>, ctx: CanvasRenderingContext2D, globalScale: number) => {
      paintNode(node, ctx, globalScale, { activeFile, hoveredNode, neighborSet, colors });
    },
    [activeFile, hoveredNode, neighborSet, colors],
  );

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

  const handleNodeDrag = useCallback((node: NodeObject<LoomNode>) => {
    node.fx = node.x;
    node.fy = node.y;
  }, []);

  const handleNodeDragEnd = useCallback((node: NodeObject<LoomNode>) => {
    node.fx = undefined;
    node.fy = undefined;
  }, []);

  return (
    <div className={styles.wrap} ref={wrapRef}>
      {loading && <div className={styles.loading}>Loading graph...</div>}

      <GraphFilters filterType={filterType} onFilterChange={setFilterType} />

      <ForceGraph2D
        ref={fgRef}
        width={dimensions.width}
        height={dimensions.height}
        graphData={filteredData}
        backgroundColor={colors.bg}
        nodeCanvasObject={nodeCanvasObject}
        nodePointerAreaPaint={paintPointerArea}
        linkColor={linkColorFn}
        linkWidth={linkWidthFn}
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
        cooldownTicks={200}
        cooldownTime={5000}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.3}
        minZoom={0.2}
        maxZoom={12}
      />

      <div className={styles.stats}>
        {stats.nodes} nodes &middot; {stats.edges} edges
      </div>

      <GraphControls
        onFit={() => fgRef.current?.zoomToFit(400, 60)}
        onZoomIn={() => {
          const z = fgRef.current?.zoom() ?? 1;
          fgRef.current?.zoom(z * 1.5, 300);
        }}
        onZoomOut={() => {
          const z = fgRef.current?.zoom() ?? 1;
          fgRef.current?.zoom(z / 1.5, 300);
        }}
      />
    </div>
  );
}
