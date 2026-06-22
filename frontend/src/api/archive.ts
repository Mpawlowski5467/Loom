import { apiClient } from "./client";
import type { NoteRecord } from "./notes";

/** An archived note as listed by the trash surface. */
export interface ArchivedNoteRecord {
  id: string;
  title: string;
  type: string;
  /** Path the note restores to, relative to ``threads/``. */
  original_path: string;
  archived_at: string;
}

export interface ArchivedListResponse {
  notes: ArchivedNoteRecord[];
}

/** List the active vault's archived notes, newest first. */
export function listArchivedNotes(
  signal?: AbortSignal,
): Promise<ArchivedListResponse> {
  return apiClient.get<ArchivedListResponse>("/api/archive", signal);
}

/**
 * Restore an archived note to its original folder. Resolves with the
 * re-activated note. Rejects with an ``ApiError`` (status 409) when an active
 * note already occupies the original path, or 404 if the id isn't in the
 * archive.
 */
export function restoreArchivedNote(id: string): Promise<NoteRecord> {
  return apiClient.post<NoteRecord>(
    `/api/archive/${encodeURIComponent(id)}/restore`,
  );
}
