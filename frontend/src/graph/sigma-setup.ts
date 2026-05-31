import Graph from "graphology";
import Sigma from "sigma";
import type { Settings } from "sigma/settings";
import { readCssVar } from "../theme/readCssVar";
import type { Note, NodeType } from "../data/types";

/**
 * Look up node colors from the active theme. Re-read on every call so the
 * graph repaints correctly after a theme swap — Sigma re-asks for each
 * node's ``color`` attribute on ``refresh()``.
 */
export function readNodePalette(): Record<NodeType, string> {
  return {
    project: readCssVar("--node-project", "#2d4a7c"),
    topic: readCssVar("--node-topic", "#4a6b3a"),
    people: readCssVar("--node-people", "#6b3a6b"),
    daily: readCssVar("--node-daily", "#8c877d"),
    capture: readCssVar("--node-capture", "#a8722a"),
    custom: readCssVar("--node-custom", "#2d6b6b"),
  };
}

export interface EdgePalette {
  edge: string;
  edgeHover: string;
  edgeFaint: string;
  label: string;
  nodeDimmed: string;
}

export function readEdgePalette(): EdgePalette {
  return {
    edge: readCssVar("--edge-color", "rgba(26,24,21,0.18)"),
    edgeHover: readCssVar("--edge-color-hover", "rgba(168,58,44,0.55)"),
    edgeFaint: readCssVar("--edge-color-faint", "rgba(26,24,21,0.05)"),
    label: readCssVar("--label-color", "#5c5851"),
    nodeDimmed: readCssVar("--node-dimmed", "rgba(140,135,125,0.18)"),
  };
}

export interface BuiltGraph {
  graph: Graph;
  baseSizes: Map<string, number>;
}

export function buildGraph(notes: Note[]): BuiltGraph {
  const graph = new Graph({ multi: false, type: "directed" });
  const baseSizes = new Map<string, number>();
  const palette = readNodePalette();

  // Pre-compute connection counts.
  const conn = new Map<string, number>();
  for (const n of notes) {
    conn.set(n.id, (conn.get(n.id) ?? 0) + n.links.length);
    for (const l of n.links) conn.set(l, (conn.get(l) ?? 0) + 1);
  }

  for (const n of notes) {
    const c = conn.get(n.id) ?? 0;
    const size = 4 + Math.min(c, 12) * 0.8;
    baseSizes.set(n.id, size);
    graph.addNode(n.id, {
      x: Math.random() * 100 - 50,
      y: Math.random() * 100 - 50,
      size,
      label: n.title,
      color: palette[n.type],
      noteType: n.type,
    });
  }
  for (const n of notes) {
    for (const l of n.links) {
      if (!graph.hasNode(l)) continue;
      if (graph.hasEdge(n.id, l) || graph.hasEdge(l, n.id)) continue;
      graph.addEdge(n.id, l);
    }
  }
  return { graph, baseSizes };
}

export function defaultSettings(): Partial<Settings> {
  const palette = readEdgePalette();
  return {
    allowInvalidContainer: true,
    labelColor: { color: palette.label },
    labelSize: 11,
    labelFont: "Inter, system-ui, sans-serif",
    labelWeight: "500",
    defaultEdgeColor: palette.edge,
    renderEdgeLabels: false,
    // Label visibility is owned by GraphView's nodeReducer (zoom-tiered by
    // degree). Disable Sigma's density-based hide/show: it competes with the
    // breathing animation and causes labels to flicker on and off every frame.
    labelDensity: 10_000,
    labelGridCellSize: 1,
    labelRenderedSizeThreshold: 0,
    enableEdgeEvents: false,
    minCameraRatio: 0.2,
    maxCameraRatio: 8,
    // Wheel-zoom feel: small per-tick ratio (1.25) + long, overlapping
    // animations (400ms). Sigma throttles incoming wheel events to
    // zoomDuration/5 = 80ms which lines up with typical trackpad cadence,
    // so fast scrolls read as one continuous slide instead of discrete jumps.
    zoomingRatio: 1.25,
    zoomDuration: 500,
  };
}

export function createSigma(graph: Graph, container: HTMLElement): Sigma {
  return new Sigma(graph, container, defaultSettings());
}

/**
 * Apply the current theme's palette to an existing graph + sigma instance.
 *
 * Updates every node's ``color`` attribute, swaps ``labelColor`` and
 * ``defaultEdgeColor`` settings, then calls ``refresh()``. Sigma 3 re-reads
 * node colors on every paint, so this is enough — there's no need to
 * dispose and recreate the renderer.
 */
export function applyPaletteToGraph(
  sigma: Sigma,
  graph: Graph,
): EdgePalette {
  const nodePalette = readNodePalette();
  const edgePalette = readEdgePalette();
  graph.forEachNode((id) => {
    const noteType = graph.getNodeAttribute(id, "noteType") as
      | NodeType
      | undefined;
    if (!noteType) return;
    graph.setNodeAttribute(id, "color", nodePalette[noteType]);
  });
  sigma.setSetting("labelColor", { color: edgePalette.label });
  sigma.setSetting("defaultEdgeColor", edgePalette.edge);
  sigma.refresh({ skipIndexation: true });
  return edgePalette;
}