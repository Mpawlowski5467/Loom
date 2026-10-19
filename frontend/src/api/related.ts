import type { Note, NodeType } from "@/data/types";
import { MOCKS_ENABLED } from "./mocks";
import { mockRelatedNotes } from "./mocks/notes";
import { searchNotesRemote } from "./search";

export interface RelatedNote {
  noteId: string;
  title: string;
  type: NodeType;
  /** 0–1, relative to the strongest match. */
  score: number;
}

export interface RelatedResult {
  items: RelatedNote[];
  /** Where the ranking came from; anything but "related" is approximate. */
  source: "related" | "search" | "local";
}

const LIMIT = 6;

/** Rank by shared links, tags and folder — the offline fallback. */
export function localRelated(
  note: Note,
  notes: readonly Note[],
): RelatedNote[] {
  const tags = new Set(note.tags);
  const scored = notes
    .filter((n) => n.id !== note.id && n.status !== "archived")
    .map((n) => {
      const linked = note.links.includes(n.id) || n.links.includes(note.id);
      const shared = n.tags.filter((t) => tags.has(t)).length;
      const raw =
        (linked ? 1 : 0) + shared * 0.5 + (n.folder === note.folder ? 0.2 : 0);
      return { n, raw };
    })
    .filter((x) => x.raw > 0)
    .sort((a, b) => b.raw - a.raw)
    .slice(0, LIMIT);
  const max = scored[0]?.raw ?? 1;
  return scored.map(({ n, raw }) => ({
    noteId: n.id,
    title: n.title,
    type: n.type,
    score: raw / max,
  }));
}

/**
 * Notes related to `note`, by hybrid search.
 *
 * BACKEND GAP (docs/ui-backend-gaps.md §5): there's no related-notes
 * endpoint, so this approximates with `/api/search?q=<title>&context=<id>`
 * and falls back to shared links/tags offline. Mocked with VITE_LOOM_MOCKS.
 */
export async function getRelatedNotes(
  note: Note,
  notes: readonly Note[],
  signal?: AbortSignal,
): Promise<RelatedResult> {
  if (MOCKS_ENABLED)
    return { items: await mockRelatedNotes(note, notes), source: "related" };
  try {
    const hits = (
      await searchNotesRemote(note.title, LIMIT + 1, signal, note.id)
    )
      .filter((h) => h.note_id !== note.id)
      .slice(0, LIMIT);
    const max = Math.max(...hits.map((h) => h.score), Number.EPSILON);
    return {
      items: hits.map((h) => ({
        noteId: h.note_id,
        title: h.title,
        type: h.type,
        score: h.score / max,
      })),
      source: "search",
    };
  } catch (err) {
    if ((err as DOMException)?.name === "AbortError") throw err;
    return { items: localRelated(note, notes), source: "local" };
  }
}
