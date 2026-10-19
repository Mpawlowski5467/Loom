import { useEffect, useState } from "react";
import { useApp } from "@/context/app-ctx";
import type { Note } from "@/data/types";

/**
 * Notes load metadata first; fetch this one's body when it's missing.
 * Returns whether the body is still loading or failed to load.
 */
export function useHydratedBody(note: Note | undefined): {
  loading: boolean;
  failed: boolean;
} {
  const { reloadNoteBody } = useApp();
  const [failedId, setFailedId] = useState<string | null>(null);
  const id = note?.id;
  const needs = !!note && note.bodyLoaded === false && !note.bodyError;
  useEffect(() => {
    if (!needs || !id || !reloadNoteBody) return;
    let live = true;
    reloadNoteBody(id).catch(() => {
      if (live) setFailedId(id);
    });
    return () => {
      live = false;
    };
  }, [needs, id, reloadNoteBody]);
  const failed = failedId === id || !!note?.bodyError;
  return { loading: needs && !failed, failed };
}
