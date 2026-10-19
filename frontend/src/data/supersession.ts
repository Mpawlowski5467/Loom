import type { Note, NoteId } from "./types";

/*
 * Supersession, as the UI reads it from frontmatter (roadmap item 3 — see
 * docs/ui-backend-gaps.md §2; nothing in the backend writes these yet):
 *   new note:  supersedes: "[[old-note]]"   valid_from: 2026-05-10
 *   old note:  status: superseded   superseded_by: "[[new-note]]"
 *              superseded_at: 2026-05-12   (when Archivist marked it)
 */

type Resolve = (raw: string) => NoteId | undefined;

function wikilinkTargets(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [value];
  return raw
    .filter((v): v is string => typeof v === "string" && v.trim() !== "")
    .map((v) => v.trim().replace(/^\[\[/, "").replace(/\]\]$/, ""));
}

function stringField(note: Note, key: string): string | null {
  const value = note.extra?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function isSuperseded(note: Note): boolean {
  return note.status === "superseded";
}

/** The date this note's content is valid from, if recorded. */
export function validFrom(note: Note): string | null {
  return stringField(note, "valid_from");
}

/** Raw `supersedes` targets of a note (wikilink text without brackets). */
export function supersedesTargets(note: Note): string[] {
  return wikilinkTargets(note.extra?.supersedes);
}

export interface Supersession {
  /** The link text as written, e.g. "cache-plan-v1". */
  target: string;
  /** The superseded note, when the link resolves. */
  oldNote: Note | null;
  /** When the old note was marked superseded, if known. */
  supersededAt: string | null;
}

/** What this note supersedes, for the banner above its title. */
export function supersessionOf(
  note: Note,
  resolve: Resolve,
  noteById: (id: NoteId) => Note | undefined,
): Supersession | null {
  const [target] = supersedesTargets(note);
  if (!target) return null;
  const id = resolve(target);
  const oldNote = id ? (noteById(id) ?? null) : null;
  const marked =
    oldNote?.history
      .slice()
      .reverse()
      .find((h) => h.action === "superseded")?.at ?? null;
  return {
    target,
    oldNote,
    supersededAt:
      (oldNote && stringField(oldNote, "superseded_at")) ?? marked ?? null,
  };
}

/** The note that replaced this one, if it says so (or one claims it). */
export function supersededBy(
  note: Note,
  notes: readonly Note[],
  resolve: Resolve,
): Note | null {
  const [explicit] = wikilinkTargets(note.extra?.superseded_by);
  const id = explicit ? resolve(explicit) : undefined;
  if (id) return notes.find((n) => n.id === id) ?? null;
  return (
    notes.find((n) =>
      supersedesTargets(n).some((t) => resolve(t) === note.id),
    ) ?? null
  );
}
