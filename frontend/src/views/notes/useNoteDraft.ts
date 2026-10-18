import { useCallback, useEffect, useState } from "react";
import {
  backendNoteToFrontend,
  getNote,
  titleMapFromNotes,
  updateNote as apiUpdateNote,
} from "@/api/notes";
import { ApiError } from "@/api/client";
import type { Note, Toast } from "@/data/types";
import {
  readNoteDraft,
  removeNoteDraft,
  writeNoteDraft,
} from "@/editor/noteDraftStorage";

export interface EditorConflict {
  remoteBody: string;
  remoteModified: string;
  message: string;
}

const versionOf = (note: Note) => note.contentVersion ?? note.modified;

interface DraftState {
  /** vault:note:bodyLoaded — a change means a different note is shown. */
  key: string;
  draft: string;
  /** Version the draft is based on; sent as base_modified on save. */
  base: string;
  /** note.body when the draft was last synced with it. */
  synced: string;
  /** Bumped whenever the draft is replaced from outside the editor. */
  revision: number;
  /** An explicit conflict message (409, recovered old draft, keep). */
  notice: string | null;
}

function seed(
  key: string,
  note: Note | null,
  vaultId: string,
  revision: number,
): DraftState {
  if (!note || note.bodyLoaded === false)
    return {
      key,
      draft: note?.body ?? "",
      base: note ? versionOf(note) : "",
      synced: note?.body ?? "",
      revision,
      notice: null,
    };
  const recovered = readNoteDraft(vaultId, note.id);
  const base = recovered?.baseModified ?? versionOf(note);
  return {
    key,
    draft: recovered?.body ?? note.body,
    base,
    synced: note.body,
    revision,
    notice:
      recovered && base !== versionOf(note)
        ? "Recovered draft is based on an older version. Review it before saving."
        : null,
  };
}

interface Options {
  note: Note | null;
  vaultId: string;
  notes: Note[];
  updateNote: (note: Note) => void;
  pushToast: (toast: Omit<Toast, "id">) => void;
}

/**
 * The editable markdown draft for one note: local recovery copies,
 * version-checked saves, and conflict handling. An incoming refresh never
 * replaces a dirty draft; it surfaces as a conflict instead.
 */
export function useNoteDraft({
  note,
  vaultId,
  notes,
  updateNote,
  pushToast,
}: Options) {
  const bodyLoaded = !!note && note.bodyLoaded !== false;
  const key = `${vaultId}:${note?.id ?? ""}:${bodyLoaded}`;
  const [state, setState] = useState<DraftState>(() =>
    seed(key, note, vaultId, 0),
  );
  const [saving, setSaving] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);

  // Adjust during render (not in an effect) so the editor never paints a
  // stale draft for a newly opened note.
  let current = state;
  if (state.key !== key) {
    current = seed(key, note, vaultId, state.revision + 1);
    setState(current);
  } else if (
    note &&
    bodyLoaded &&
    note.body !== state.synced &&
    state.draft === state.synced
  ) {
    // Same note refreshed (SSE) while clean: follow the remote body.
    current = {
      ...state,
      draft: note.body,
      base: versionOf(note),
      synced: note.body,
      revision: state.revision + 1,
      notice: null,
    };
    setState(current);
  }

  const dirty = bodyLoaded && !!note && current.draft !== note.body;
  const conflict: EditorConflict | null =
    note && dirty && (current.notice || current.base !== versionOf(note))
      ? {
          remoteBody: note.body,
          remoteModified: note.modified,
          message:
            current.notice ??
            "This note changed while you were editing. Your draft is safe.",
        }
      : null;

  // If local persistence is unavailable, warn before the browser discards
  // the only copy of the user's changes.
  useEffect(() => {
    if (!storageFailed || !dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, storageFailed]);

  const setDraft = useCallback(
    (next: string) => {
      if (!note || !bodyLoaded) return;
      setState((s) => ({ ...s, draft: next }));
      if (next === note.body) {
        removeNoteDraft(vaultId, note.id);
        setStorageFailed(false);
        return;
      }
      const saved = writeNoteDraft(vaultId, note.id, {
        body: next,
        baseModified: current.base,
        savedAt: new Date().toISOString(),
      });
      setStorageFailed(!saved);
    },
    [note, bodyLoaded, vaultId, current.base],
  );

  /** Replace the draft with a fresh remote copy of the note. */
  const adopt = useCallback(
    (fresh: Note) => {
      removeNoteDraft(vaultId, fresh.id);
      setStorageFailed(false);
      setState((s) => ({
        ...s,
        draft: fresh.body,
        base: versionOf(fresh),
        synced: fresh.body,
        revision: s.revision + 1,
        notice: null,
      }));
    },
    [vaultId],
  );

  const save = useCallback(
    async (overwrite = false) => {
      if (!note || !dirty || saving) return;
      setSaving(true);
      try {
        const record = await apiUpdateNote(note.id, {
          body: current.draft,
          ...(overwrite ? {} : { base_modified: current.base }),
        });
        const fresh = backendNoteToFrontend(record, titleMapFromNotes(notes));
        updateNote(fresh);
        adopt(fresh);
        pushToast({
          icon: "✓",
          agent: "weaver",
          body: `Saved [[${record.title}]]`,
        });
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          setState((s) => ({
            ...s,
            notice: "Save was blocked because a newer version exists.",
          }));
          pushToast({
            icon: "⚠",
            agent: "sentinel",
            body: "Version conflict: your draft was kept locally.",
          });
          return;
        }
        pushToast({
          icon: "⚠",
          agent: "sentinel",
          body: `Save failed: ${err instanceof Error ? err.message : "unknown error"}`,
        });
      } finally {
        setSaving(false);
      }
    },
    [
      note,
      dirty,
      saving,
      current.draft,
      current.base,
      notes,
      updateNote,
      adopt,
      pushToast,
    ],
  );

  const reloadRemote = useCallback(async () => {
    if (!note) return;
    try {
      const fresh = backendNoteToFrontend(
        await getNote(note.id),
        titleMapFromNotes(notes),
      );
      updateNote(fresh);
      adopt(fresh);
    } catch (err) {
      pushToast({
        icon: "⚠",
        agent: "sentinel",
        body: err instanceof Error ? err.message : "Could not reload note",
      });
    }
  }, [note, notes, updateNote, adopt, pushToast]);

  const discard = useCallback(() => {
    if (note) adopt(note);
  }, [note, adopt]);

  const keepDraft = useCallback(
    () =>
      setState((s) => ({
        ...s,
        notice: "Keeping your local draft. Saving remains version-checked.",
      })),
    [],
  );

  return {
    draft: current.draft,
    revision: current.revision,
    bodyLoaded,
    dirty,
    saving,
    storageFailed,
    conflict,
    setDraft,
    save,
    reloadRemote,
    discard,
    keepDraft,
  };
}
