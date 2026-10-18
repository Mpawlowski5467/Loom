import type Graph from "graphology";
import type { Note } from "../data/types";

/**
 * Structural diffing between the incoming notes and the live graphology graph.
 *
 * The graph view keeps one Graph + Sigma instance for its whole lifetime and
 * applies node/edge additions and removals in place (see graphSync.ts), the
 * way Obsidian's renderer diffs its node map against long-lived objects
 * instead of recreating the renderer. Everything here is pure; the caller
 * performs the mutations.
 */

/** Undirected canonical key for a link pair. buildGraph collapses a<->b to a
 * single edge, and structuralKey uses the same form. */
export function edgePairKey(a: string, b: string): string {
  return a < b ? `${a}~${b}` : `${b}~${a}`;
}

export interface DesiredStructure {
  /** Node ids in notes order. */
  ids: Set<string>;
  /** Canonical pair → [source, target] in the first-seen direction. Links
   * to notes that are not present are dropped. */
  edges: Map<string, readonly [string, string]>;
}

/** The node and edge sets the notes describe, matching buildGraph exactly. */
export function desiredStructure(notes: Note[]): DesiredStructure {
  const ids = new Set<string>(notes.map((n) => n.id));
  const edges = new Map<string, readonly [string, string]>();
  for (const n of notes) {
    for (const l of n.links) {
      if (!ids.has(l)) continue;
      const key = edgePairKey(n.id, l);
      if (!edges.has(key)) edges.set(key, [n.id, l]);
    }
  }
  return { ids, edges };
}

export interface StructureDiff {
  /** New node ids, in notes order. */
  addedNodes: string[];
  removedNodes: string[];
  addedEdges: Array<readonly [string, string]>;
  /** Graph edge keys to drop. Edges touching a removed node are left out:
   * dropping the node removes them. */
  removedEdges: string[];
}

export function diffGraphStructure(
  graph: Graph,
  desired: DesiredStructure,
): StructureDiff {
  const addedNodes = [...desired.ids].filter((id) => !graph.hasNode(id));
  const removedNodes = graph.filterNodes((id) => !desired.ids.has(id));
  const present = new Set<string>();
  const removedEdges: string[] = [];
  graph.forEachEdge((edge, _attrs, source, target) => {
    const key = edgePairKey(source, target);
    if (desired.edges.has(key) && !present.has(key)) {
      present.add(key);
      return;
    }
    if (desired.ids.has(source) && desired.ids.has(target)) {
      removedEdges.push(edge);
    }
  });
  const addedEdges: Array<readonly [string, string]> = [];
  for (const [key, pair] of desired.edges) {
    if (!present.has(key)) addedEdges.push(pair);
  }
  return { addedNodes, removedNodes, addedEdges, removedEdges };
}

export function isEmptyDiff(diff: StructureDiff): boolean {
  return (
    diff.addedNodes.length === 0 &&
    diff.removedNodes.length === 0 &&
    diff.addedEdges.length === 0 &&
    diff.removedEdges.length === 0
  );
}

/** Undirected neighbor lists for ``ids`` under the desired structure. Self
 * links are skipped: a node cannot be placed beside itself. */
export function adjacencyFor(
  desired: DesiredStructure,
  ids: Iterable<string>,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const id of ids) out.set(id, []);
  for (const [source, target] of desired.edges.values()) {
    if (source === target) continue;
    out.get(source)?.push(target);
    out.get(target)?.push(source);
  }
  return out;
}
