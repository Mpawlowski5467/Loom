import type { Note } from "./types";

export function linkTarget(raw: string): string {
  return raw
    .split("|", 1)[0]!
    .split("#", 1)[0]!
    .trim()
    .replace(/\\/g, "/")
    .replace(/\.md$/i, "")
    .replace(/[‐‑‒–—―−﹘﹣－]/g, "-")
    .replace(/[\u00a0\u202f\u2009]/g, " ")
    .toLowerCase();
}

export function noteLinkKeys(
  note: Pick<Note, "id" | "title" | "folder" | "filename" | "aliases">,
): string[] {
  const slug =
    note.filename?.replace(/\.md$/i, "") ??
    note.title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  return [
    ...new Set(
      [
        note.id,
        note.title,
        slug,
        `${note.folder}/${slug}`,
        ...(note.aliases ?? []),
      ]
        .map(linkTarget)
        .filter(Boolean),
    ),
  ];
}

/** Ambiguous bare titles/slugs deliberately have no winning note. */
export function buildWikilinkMap(notes: Note[]): Map<string, string> {
  const matches = new Map<string, Set<string>>();
  for (const note of notes)
    for (const key of noteLinkKeys(note)) {
      const ids = matches.get(key) ?? new Set<string>();
      ids.add(note.id);
      matches.set(key, ids);
    }
  return new Map(
    [...matches]
      .filter(([, ids]) => ids.size === 1)
      .map(([key, ids]) => [key, [...ids][0]!]),
  );
}

export function wikilinkCandidates(notes: Note[], raw: string): Note[] {
  const key = linkTarget(raw);
  return notes.filter((note) => noteLinkKeys(note).includes(key));
}
