import { ApiError, apiClient } from "./client";
import { MOCKS_ENABLED } from "./mocks";
import { mockNoteFindings } from "./mocks/findings";
import type { Note } from "@/data/types";

/** One persisted audit result about a note. */
export interface NoteFinding {
  agent: string;
  /** e.g. stale, orphan, duplicate, contradiction. */
  kind: string;
  message: string;
  created: string;
}

/**
 * Archivist's findings for a note. `null` when the backend can't say
 * (no such endpoint), as distinct from "no findings".
 *
 * BACKEND GAP (docs/ui-backend-gaps.md §8): `GET /api/notes/{id}/findings`
 * doesn't exist; Archivist issues are only returned by a run. Mocked with
 * VITE_LOOM_MOCKS.
 */
export async function getNoteFindings(
  note: Note,
  signal?: AbortSignal,
): Promise<NoteFinding[] | null> {
  if (MOCKS_ENABLED) return mockNoteFindings(note);
  try {
    return await apiClient.get<NoteFinding[]>(
      `/api/notes/${encodeURIComponent(note.id)}/findings`,
      signal,
    );
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 405))
      return null;
    throw err;
  }
}
