import type { Note } from "@/data/types";
import { linkTarget, noteLinkKeys } from "@/data/wikilinks";

/** An open `[[query` before the cursor, in plain text. */
export interface WikilinkQuery {
  start: number;
  end: number;
  text: string;
}

export function activeWikilinkQuery(
  value: string,
  cursor: number,
): WikilinkQuery | null {
  const prefix = value.slice(0, cursor);
  const start = prefix.lastIndexOf("[[");
  if (start === -1 || prefix.slice(start + 2).includes("]]")) return null;
  const text = prefix.slice(start + 2);
  return text.includes("\n") || text.includes("|")
    ? null
    : { start, end: cursor, text };
}

/**
 * The shortest link text that resolves to `note`: its slug, or
 * `folder/slug` when the slug alone is ambiguous.
 */
export function wikilinkTarget(note: Note, notes: readonly Note[]): string {
  const slug = (note.filename ?? note.title).replace(/\.md$/i, "");
  const matches = notes.filter((candidate) =>
    noteLinkKeys(candidate).includes(linkTarget(slug)),
  );
  return matches.length === 1 ? slug : `${note.folder}/${slug}`;
}

/** Notes matching a partial link, best-effort, capped. */
export function wikilinkSuggestions(
  notes: readonly Note[],
  query: string,
  limit = 8,
): Note[] {
  const text = linkTarget(query);
  return notes
    .filter((n) => n.status !== "archived")
    .filter((n) => !text || noteLinkKeys(n).some((key) => key.includes(text)))
    .slice(0, limit);
}
