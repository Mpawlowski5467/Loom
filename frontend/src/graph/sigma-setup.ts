import Graph from "graphology";
import Sigma from "sigma";
import type { Settings } from "sigma/settings";
import type { Note, NodeType } from "../data/types";

const NODE_COLOR: Record<NodeType, string> = {
  project: "#2d4a7c",
  topic: "#4a6b3a",
  people: "#6b3a6b",
  daily: "#8c877d",
  capture: "#a8722a",
  custom: "#2d6b6b",
};

export interface BuiltGraph {
  graph: Graph;
  baseSizes: Map<string, number>;
}

export function buildGraph(notes: Note[]): BuiltGraph {
  const graph = new Graph({ multi: false, type: "directed" });
  const baseSizes = new Map<string, number>();

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
      color: NODE_COLOR[n.type],
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
  return {
    allowInvalidContainer: true,
    labelColor: { color: "#5c5851" },
    labelSize: 11,
    labelFont: "Inter, system-ui, sans-serif",
    labelWeight: "500",
    defaultEdgeColor: "rgba(26,24,21,0.18)",
    renderEdgeLabels: false,
    labelDensity: 0.6,
    labelGridCellSize: 80,
    labelRenderedSizeThreshold: 7,
    enableEdgeEvents: false,
    minCameraRatio: 0.2,
    maxCameraRatio: 8,
  };
}

export function createSigma(graph: Graph, container: HTMLElement): Sigma {
  return new Sigma(graph, container, defaultSettings());
}
