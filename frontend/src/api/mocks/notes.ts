import type { Note } from "@/data/types";
import type { RelatedNote } from "../related";
import { mockDelay } from "./index";

/** Deterministic pseudo-scores so the score bars look like real output. */
export function mockRelatedNotes(
  note: Note,
  notes: readonly Note[],
): Promise<RelatedNote[]> {
  const candidates = notes.filter(
    (n) => n.id !== note.id && n.status !== "archived",
  );
  const picked = candidates
    .map((n) => ({
      n,
      s:
        n.tags.filter((t) => note.tags.includes(t)).length +
        (note.links.includes(n.id) ? 2 : 0),
    }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 5);
  return mockDelay(
    picked.map(({ n }, i) => ({
      noteId: n.id,
      title: n.title,
      type: n.type,
      score: Math.max(0.2, 1 - i * 0.17),
    })),
  );
}

/** A fictional paragraph standing in for Weaver's section draft. */
export function mockDraftSection(heading: string): Promise<string> {
  const topic = heading.trim() || "this section";
  return mockDelay(
    `Draft for ${topic}: summarise the decision, the constraint that drove it, and the follow-up owner. Link the notes it depends on so Spider can keep the graph in step.`,
    600,
  );
}
