import Graph from "graphology";
import { readCssVar } from "../theme/readCssVar";
import type { Note, NodeType } from "../data/types";
import { depthColorFor, zForNode } from "./depth";
import { desiredStructure } from "./graphDiff";

/*
 * The graphology model behind the graph view: node colors, sizes and depth
 * attributes derived from notes, and the fresh graph build. Renderer-free, so
 * graph logic can use it without loading Sigma (which needs WebGL).
 */

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

export interface BuiltGraph {
  graph: Graph;
  baseSizes: Map<string, number>;
}

/** Per-note link counts (outgoing + incoming) that drive size and depth. */
export function connectionCounts(notes: Note[]): Map<string, number> {
  const conn = new Map<string, number>();
  for (const n of notes) {
    conn.set(n.id, (conn.get(n.id) ?? 0) + n.links.length);
    for (const l of n.links) conn.set(l, (conn.get(l) ?? 0) + 1);
  }
  return conn;
}

/** Unscaled node size for a connection count (capped at 12 links). */
export function baseSizeFor(connections: number): number {
  return 4 + Math.min(connections, 12) * 0.8;
}

export interface NodeVisuals {
  size: number;
  z: number;
  depthColor: string;
  zIndex: number;
}

/** Size + faux-3D depth attributes for a node. Static per node; the
 * reducers/overlays read them, and zIndex draws nearer nodes over deeper ones
 * (Sigma sorts when the zIndex setting is on). */
export function nodeVisualsFor(
  id: string,
  type: NodeType,
  connections: number,
  palette: Record<NodeType, string>,
  bg: string,
): NodeVisuals {
  const z = zForNode(id, connections);
  return {
    size: baseSizeFor(connections),
    z,
    depthColor: depthColorFor(palette[type], bg, z),
    zIndex: 1 - z,
  };
}

/** Every attribute a note's node carries except its position. */
export function nodeAttributesFor(
  note: Note,
  connections: number,
  palette: Record<NodeType, string>,
  bg: string,
): Record<string, unknown> & NodeVisuals {
  return {
    label: note.title,
    color: palette[note.type],
    noteType: note.type,
    ...nodeVisualsFor(note.id, note.type, connections, palette, bg),
  };
}

export function buildGraph(notes: Note[]): BuiltGraph {
  const graph = new Graph({ multi: false, type: "directed" });
  const baseSizes = new Map<string, number>();
  const palette = readNodePalette();
  const conn = connectionCounts(notes);
  const bg = readCssVar("--bg-base", "#f5f1e8");
  for (const n of notes) {
    const attrs = nodeAttributesFor(n, conn.get(n.id) ?? 0, palette, bg);
    baseSizes.set(n.id, attrs.size);
    graph.addNode(n.id, {
      x: Math.random() * 100 - 50,
      y: Math.random() * 100 - 50,
      ...attrs,
    });
  }
  for (const [source, target] of desiredStructure(notes).edges.values()) {
    graph.addEdge(source, target);
  }
  return { graph, baseSizes };
}
