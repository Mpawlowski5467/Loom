/**
 * Graph diff/update: incrementally update graphology graph from new API data.
 */

import type Graph from "graphology";
import type { VaultGraph } from "../api";
import { NODE_COLORS_HEX } from "../constants";
import { positionNearNeighbors } from "./layout";
import { updateBreathingNode } from "./breathing";
import { BASE_NODE_SIZE, SIZE_SCALE } from "./reducers";

/**
 * Update an existing graph in-place from new API data.
 * Returns true if anything changed.
 */
export function updateGraph(data: VaultGraph, graph: Graph): boolean {
  const existingIds = new Set(graph.nodes());
  const newIds = new Set(data.nodes.map((n) => n.id));
  let changed = false;

  // Remove stale nodes
  for (const id of existingIds) {
    if (!newIds.has(id)) {
      graph.dropNode(id);
      changed = true;
    }
  }

  // Add/update nodes
  for (const n of data.nodes) {
    if (!graph.hasNode(n.id)) {
      graph.addNode(n.id, {
        label: n.title,
        x: 0,
        y: 0,
        size: BASE_NODE_SIZE + n.link_count * SIZE_SCALE,
        color: NODE_COLORS_HEX[n.type] ?? "#94a3b8",
        noteType: n.type,
        pinned: false,
      });
      changed = true;
    } else {
      const cur = graph.getNodeAttributes(n.id);
      graph.mergeNodeAttributes(n.id, {
        label: n.title,
        size: BASE_NODE_SIZE + n.link_count * SIZE_SCALE,
        color: NODE_COLORS_HEX[n.type] ?? "#94a3b8",
        noteType: n.type,
        pinned: cur.pinned,
      });
      updateBreathingNode(graph, n.id);
    }
  }

  // Position new nodes near neighbors
  for (const n of data.nodes) {
    if (!existingIds.has(n.id) && graph.hasNode(n.id)) {
      positionNearNeighbors(graph, n.id);
    }
  }

  // Rebuild edges
  const existingEdges = new Set<string>();
  graph.forEachEdge((_e, _a, s, t) => existingEdges.add(`${s}->${t}`));
  const newEdges = new Set(data.edges.map((e) => `${e.source}->${e.target}`));

  graph.forEachEdge((edge, _attrs, source, target) => {
    if (!newEdges.has(`${source}->${target}`)) {
      graph.dropEdge(edge);
      changed = true;
    }
  });

  for (const e of data.edges) {
    if (
      !existingEdges.has(`${e.source}->${e.target}`) &&
      graph.hasNode(e.source) &&
      graph.hasNode(e.target)
    ) {
      try {
        graph.addEdge(e.source, e.target, { weight: 1 });
        changed = true;
      } catch {
        /* dup */
      }
    }
  }

  return changed;
}
