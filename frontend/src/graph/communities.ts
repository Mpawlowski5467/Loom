import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import type { Note, NoteId } from "@/data/types";

/** Communities that get a color (`--community-1..4`); the rest are "Other". */
export const COMMUNITY_SLOTS = 4;

export interface Community {
  /** 0–3 for the largest communities; null for the "Other" bucket. */
  slot: number | null;
  /** Named after its most-linked note ("Other" for the bucket). */
  label: string;
  size: number;
  anchorId: NoteId | null;
}

export interface CommunityResult {
  /** Note id → color slot, or null when the note falls in "Other". */
  slotOf: ReadonlyMap<NoteId, number | null>;
  /** Colored communities by size, then "Other" when it has members. */
  communities: Community[];
  /** Changes whenever any note's slot or a community's label changes. */
  key: string;
}

/** mulberry32: Louvain's random walk needs a seed to be deterministic. */
function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Detect communities in the link graph with Louvain, seeded so the same
 * vault always yields the same grouping. The four largest communities of
 * two or more notes get a color slot; everything else is "Other".
 *
 * BACKEND GAP (docs/ui-backend-gaps.md §3): replace with server-side
 * communities once the graph endpoint provides them.
 */
export function detectCommunities(notes: readonly Note[]): CommunityResult {
  const graph = new Graph({ type: "undirected", multi: false });
  const sorted = [...notes].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  for (const n of sorted) graph.addNode(n.id);
  for (const n of sorted)
    for (const target of [...n.links].sort())
      if (
        target !== n.id &&
        graph.hasNode(target) &&
        !graph.hasEdge(n.id, target)
      )
        graph.addEdge(n.id, target);

  const slotOf = new Map<NoteId, number | null>(
    sorted.map((n) => [n.id, null]),
  );
  if (graph.size === 0) return finish(slotOf, [], notes);

  const mapping = louvain(graph, { rng: seededRng(0x10a0) });
  const groups = new Map<number, NoteId[]>();
  for (const [id, community] of Object.entries(mapping))
    groups.set(community, [...(groups.get(community) ?? []), id]);

  const ranked = [...groups.values()]
    .filter((members) => members.length >= 2)
    .map((members) => members.sort())
    .sort((a, b) => b.length - a.length || (a[0]! < b[0]! ? -1 : 1))
    .slice(0, COMMUNITY_SLOTS);

  const byId = new Map(notes.map((n) => [n.id, n]));
  const communities: Community[] = ranked.map((members, slot) => {
    const anchorId = members.reduce((best, id) => {
      const d = graph.degree(id) - graph.degree(best);
      if (d !== 0) return d > 0 ? id : best;
      return (byId.get(id)?.title ?? id) < (byId.get(best)?.title ?? best)
        ? id
        : best;
    });
    for (const id of members) slotOf.set(id, slot);
    return {
      slot,
      label: byId.get(anchorId)?.title ?? anchorId,
      size: members.length,
      anchorId,
    };
  });
  return finish(slotOf, communities, notes);
}

function finish(
  slotOf: Map<NoteId, number | null>,
  communities: Community[],
  notes: readonly Note[],
): CommunityResult {
  const other = notes.length - communities.reduce((n, c) => n + c.size, 0);
  return {
    slotOf,
    key: membershipKey(slotOf, communities),
    communities:
      other > 0
        ? [
            ...communities,
            { slot: null, label: "Other", size: other, anchorId: null },
          ]
        : communities,
  };
}

/** FNV-1a over every (id, slot) pair plus the labels: a compact change key. */
function membershipKey(
  slotOf: ReadonlyMap<NoteId, number | null>,
  communities: readonly Community[],
): string {
  let h = 0x811c9dc5;
  const feed = (text: string) => {
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  };
  for (const [id, slot] of slotOf) feed(`${id}=${slot ?? "-"};`);
  for (const c of communities) feed(`${c.label}|`);
  return `${slotOf.size}:${(h >>> 0).toString(36)}`;
}
