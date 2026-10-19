import { useCallback } from "react";
import {
  archiveNote as apiArchiveNote,
  backendNoteToFrontend,
  titleMapFromNotes,
  updateNote as apiUpdateNote,
} from "@/api/notes";
import { useApp } from "@/context/app-ctx";
import type { Note } from "@/data/types";

const versionOf = (note: Note) => note.contentVersion ?? note.modified;

/** Title, tag and archive edits for one note, all version-checked. */
export function useNoteActions(note: Note | null) {
  const { notes, updateNote, removeNote, pushToast, setTab } = useApp();

  const failed = useCallback(
    (err: unknown, fallback: string) =>
      pushToast({
        icon: "⚠",
        agent: "sentinel",
        body: err instanceof Error ? err.message : fallback,
      }),
    [pushToast],
  );

  /** Resolves true when the title was saved (or unchanged). */
  const rename = useCallback(
    async (title: string, base: string): Promise<boolean> => {
      const next = title.trim();
      if (!note || !next || next === note.title) return true;
      try {
        const record = await apiUpdateNote(note.id, {
          title: next,
          base_modified: base,
        });
        updateNote(backendNoteToFrontend(record, titleMapFromNotes(notes)));
        pushToast({
          icon: "✎",
          agent: "weaver",
          body: `Renamed to [[${record.title}]]`,
        });
        return true;
      } catch (err) {
        failed(err, "Rename failed");
        return false;
      }
    },
    [note, notes, updateNote, pushToast, failed],
  );

  const setTags = useCallback(
    async (tags: string[]): Promise<boolean> => {
      if (!note) return false;
      try {
        const record = await apiUpdateNote(note.id, {
          tags,
          base_modified: versionOf(note),
        });
        updateNote(backendNoteToFrontend(record, titleMapFromNotes(notes)));
        return true;
      } catch (err) {
        failed(err, "Could not update tags");
        return false;
      }
    },
    [note, notes, updateNote, failed],
  );

  /** Throws on failure so the confirm dialog can show the error. */
  const archive = useCallback(
    async (base: string) => {
      if (!note) return;
      await apiArchiveNote(note.id, base);
      removeNote(note.id);
      pushToast({
        icon: "📦",
        agent: "archivist",
        body: `Archived [[${note.title}]]`,
      });
      setTab("graph");
    },
    [note, removeNote, pushToast, setTab],
  );

  return { rename, setTags, archive, versionOf };
}
