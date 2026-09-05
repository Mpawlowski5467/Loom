import { apiClient } from "./client";

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
