import { ApiError, apiClient } from "./client";
import { MOCKS_ENABLED, mockDelay } from "./mocks";

export interface ConnectionEvidence {
  direction: "incoming" | "outgoing";
  source_id: string;
  target_id: string;
  state: string;
  method: string;
  rationale: string;
  source_excerpt: string;
  target_excerpt: string;
  score: number | null;
  created: string;
  agent: string;
  run_id?: string;
  source_modified: string;
  target_modified: string;
  source_title?: string;
  target_title?: string;
}
export function acceptConnection(
  payload: Pick<
    ConnectionEvidence,
    "source_id" | "target_id" | "source_modified" | "target_modified"
  >,
): Promise<{ status: string }> {
  return apiClient.post("/api/connections/accept", payload);
}
export function getConnections(
  noteId: string,
): Promise<{ note_id: string; connections: ConnectionEvidence[] }> {
  return apiClient.get(`/api/connections/${encodeURIComponent(noteId)}`);
}

/**
 * Dismiss a suggested link so later scans don't offer it again.
 *
 * BACKEND GAP (docs/ui-backend-gaps.md §6): `POST /api/connections/dismiss`
 * doesn't exist. Resolves `false` when the backend can't record it, so the
 * caller can remember the dismissal locally instead.
 */
export async function dismissConnection(
  payload: Pick<ConnectionEvidence, "source_id" | "target_id">,
): Promise<boolean> {
  if (MOCKS_ENABLED) return mockDelay(true);
  try {
    await apiClient.post("/api/connections/dismiss", payload);
    return true;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 405))
      return false;
    throw err;
  }
}
