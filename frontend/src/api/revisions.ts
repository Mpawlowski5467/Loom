import { apiClient } from "./client";
import type { NoteRecord } from "./notes";

export interface RevisionSummary {
  id: string;
  run_id: string;
  caller: string;
  created: string;
}
export interface RevisionDetail extends RevisionSummary {
  before: Record<string, string | null>;
  after: Record<string, string | null>;
  current_hash: string;
}
export interface RunChangePreview {
  files: Array<{
    path: string;
    before: string | null;
    after: string | null;
    current_hash: string;
    conflict: boolean;
  }>;
  conflicts: string[];
}
export const listRevisions = (note: string) =>
  apiClient.get<RevisionSummary[]>(
    `/api/revisions?note_id=${encodeURIComponent(note)}`,
  );
export const getRevision = (id: string, note: string) =>
  apiClient.get<RevisionDetail>(
    `/api/revisions/${encodeURIComponent(id)}?note_id=${encodeURIComponent(note)}`,
  );
export const restoreRevision = (id: string, note: string, hash: string) =>
  apiClient.post<NoteRecord>(
    `/api/revisions/${encodeURIComponent(id)}/restore`,
    { note_id: note, expected_hash: hash },
  );
export const previewUndoRun = (id: string) =>
  apiClient.get<RunChangePreview>(
    `/api/revisions/runs/${encodeURIComponent(id)}`,
  );
export const undoRun = (id: string, hashes: Record<string, string>) =>
  apiClient.post<{ status: string }>(
    `/api/revisions/runs/${encodeURIComponent(id)}/undo`,
    { expected_hashes: hashes },
  );
