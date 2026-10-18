import { useEffect, useState } from "react";
import { listHistory, notePath, type HistoryEntry } from "@/api/history";
import type { Note } from "@/data/types";

/**
 * The newest git commit touching a note, refetched when the note changes.
 * null while loading, offline, or with vault history disabled.
 */
export function useLastCommit(note: Note | null): HistoryEntry | null {
  const [entry, setEntry] = useState<{
    key: string;
    value: HistoryEntry | null;
  } | null>(null);
  const path = note
    ? notePath(note.folder, note.filename ?? `${note.id}.md`)
    : null;
  const key = `${path}@${note?.modified ?? ""}`;

  useEffect(() => {
    if (!path) return;
    let active = true;
    listHistory({ path, limit: 1 }).then(
      (rows) => active && setEntry({ key, value: rows[0] ?? null }),
      () => active && setEntry({ key, value: null }),
    );
    return () => {
      active = false;
    };
  }, [path, key]);

  return entry?.key === key ? entry.value : null;
}
