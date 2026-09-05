import { apiClient } from "./client";

export interface DuplicateEvidence {
  note_id: string;
  title: string;
  score: number;
  title_overlap: string[];
  body_overlap: string[];
  rationale: string;
}

export function findDuplicateCaptures(
  capturePath: string,
  signal?: AbortSignal,
): Promise<DuplicateEvidence[]> {
  return apiClient.post(
    "/api/capture-review/duplicates",
    {
      capture_path: capturePath,
    },
    signal,
  );
}

export function mergeCaptureReview(
  payload: {
    capture_path: string;
    target_note_id: string;
    body: string;
    base_modified: string;
  },
  signal?: AbortSignal,
): Promise<{ status: string; note_id: string }> {
  return apiClient.post("/api/capture-review/merge", payload, signal);
}
