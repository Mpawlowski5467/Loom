import { apiClient } from "./client";

export interface TraceMessage {
  role: string;
  content: string;
}

export interface TraceDetail {
  id: string;
  timestamp: string;
  provider: string;
  model: string;
  caller: string;
  system: string;
  messages: TraceMessage[];
  response: string;
  duration_ms: number;
  error: string;
  run_id?: string;
  step?: string;
}

export interface TraceSummary {
  id: string;
  timestamp: string;
  provider: string;
  model: string;
  caller: string;
  duration_ms: number;
  error: string;
  response_preview: string;
  run_id?: string;
  step?: string;
}

export function fetchTrace(id: string): Promise<TraceDetail> {
  return apiClient.get<TraceDetail>(`/api/traces/${id}`);
}

export function listTraces(
  limit: number = 50,
  caller?: string,
): Promise<TraceSummary[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (caller) params.set("caller", caller);
  return apiClient.get<TraceSummary[]>(`/api/traces?${params}`);
}

// The /api/traces/disk and /disk/dates paging endpoints still exist on the
// backend, but their clients (listTracesDisk / listTraceDates) were removed
// along with TraceFeed — the Runs view covers that history now.
