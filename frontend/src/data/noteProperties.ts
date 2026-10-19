import type { Note } from "./types";

export interface NoteProperty {
  key: string;
  label: string;
  value: string;
}

/** Frontmatter keys shown elsewhere (banner, tags, links) or internal. */
const HIDDEN_EXTRA = new Set([
  "aliases",
  "supersedes",
  "superseded_by",
  "superseded_at",
  "valid_from",
  "link_evidence",
  "publication_state",
  "review_required",
  "review_reasons",
  "flagged",
  "flag_reasons",
  "validation",
  "validation_mode",
  "validation_reasons",
  "schema_version",
  "draft_note_id",
  "draft_path",
  "enforcement_outcome",
  "source_coverage",
  "provenance",
]);

function labelFor(key: string): string {
  const words = key.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function display(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((v) => typeof v === "string" || typeof v === "number")
  )
    return value.join(", ");
  return null;
}

/**
 * Frontmatter beyond status, valid-from and tags, in a stable order: the
 * fields every note has, then any other scalar fields alphabetically.
 */
export function extraProperties(note: Note): NoteProperty[] {
  const base: NoteProperty[] = [
    { key: "type", label: "Type", value: note.type },
    { key: "created", label: "Created", value: note.created },
    { key: "modified", label: "Updated", value: note.modified },
  ];
  if (note.author)
    base.push({ key: "author", label: "Author", value: note.author });
  if (note.source)
    base.push({ key: "source", label: "Source", value: note.source });
  if (note.aliases?.length)
    base.push({
      key: "aliases",
      label: "Aliases",
      value: note.aliases.join(", "),
    });
  const rest = Object.entries(note.extra ?? {})
    .filter(([key]) => !HIDDEN_EXTRA.has(key) && !key.startsWith("_"))
    .map(([key, value]) => ({
      key,
      label: labelFor(key),
      value: display(value),
    }))
    .filter((p): p is NoteProperty => p.value !== null)
    .sort((a, b) => a.key.localeCompare(b.key));
  return [...base, ...rest];
}
