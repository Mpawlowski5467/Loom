import type { Note } from "../data/types";

/**
 * A stable key describing the graph's STRUCTURE — its node set and edge set —
 * independent of note content. Two notes arrays with the same nodes and links
 * produce the same key even if titles/tags/bodies changed.
 *
 * Used as the rebuild dependency for the Sigma instance: a body/title/tag edit
 * leaves this key unchanged, so the expensive teardown + ForceAtlas2 rerun is
 * skipped and content is patched in place instead. Only adding/removing a note
 * or a link changes the key.
 */
export function structuralKey(notes: Note[]): string {
  const ids = notes.map((n) => n.id).sort();
  const edges: string[] = [];
  for (const n of notes) {
    for (const l of n.links) {
      // Undirected canonical form — buildGraph collapses a<->b to one edge, so
      // the key must treat the pair order-independently to match.
      edges.push(n.id < l ? `${n.id}~${l}` : `${l}~${n.id}`);
    }
  }
  edges.sort();
  // Dedupe edges so a~b listed from both endpoints counts once.
  let lastEdge = "";
  const uniqueEdges: string[] = [];
  for (const e of edges) {
    if (e !== lastEdge) {
      uniqueEdges.push(e);
      lastEdge = e;
    }
  }
  return `${ids.join(",")}|${uniqueEdges.join(",")}`;
}

/**
 * A stable key describing per-node CONTENT that the graph renders directly:
 * title (label) and type (color/swatch). Changes here can be patched onto the
 * live graph without a structural rebuild.
 */
export function contentKey(notes: Note[]): string {
  return [...notes]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((n) => `${n.id}:${n.title}:${n.type}`)
    .join("|");
}
