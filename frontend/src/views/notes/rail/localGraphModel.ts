import Graph from "graphology";
import type { Note, NodeType } from "@/data/types";
import type { ThemeColors } from "@/theme/useThemeColors";

/** Neighbours shown around the note; more get dropped, nearest first. */
export const MAX_NEIGHBORS = 12;

/**
 * Node color by note type, from the community palette. Temporary: the
 * graph phase replaces type coloring with detected communities.
 */
export function typeColor(type: NodeType, colors: ThemeColors): string {
  switch (type) {
    case "project":
      return colors.community[0];
    case "capture":
      return colors.community[1];
    case "topic":
      return colors.community[2];
    case "people":
      return colors.community[3];
    default:
      return colors.mutedForeground;
  }
}

/** The 1-hop neighbourhood of `note`, laid out as a ring around it. */
export function buildLocalGraph(
  note: Note,
  neighbors: Note[],
  colors: ThemeColors,
): Graph {
  const graph = new Graph({ type: "undirected" });
  graph.addNode(note.id, {
    x: 0,
    y: 0,
    size: 9,
    label: note.title,
    color: colors.brand,
  });
  const ids = new Set(neighbors.map((n) => n.id));
  neighbors.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / neighbors.length - Math.PI / 2;
    graph.addNode(n.id, {
      x: Math.cos(angle),
      y: Math.sin(angle),
      size: 5,
      label: n.title,
      color: typeColor(n.type, colors),
    });
    graph.addEdge(note.id, n.id, { color: colors.brand, size: 1 });
  });
  for (const n of neighbors)
    for (const target of n.links)
      if (ids.has(target) && target !== n.id && !graph.hasEdge(n.id, target))
        graph.addEdge(n.id, target, { color: colors.borderStrong, size: 0.5 });
  return graph;
}
