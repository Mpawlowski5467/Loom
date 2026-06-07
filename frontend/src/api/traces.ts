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

/** Read traces persisted on disk for one calendar day (YYYY-MM-DD). */
export function listTracesDisk(
  date: string,
  caller?: string,
  limit: number = 100,
): Promise<TraceSummary[]> {
  const params = new URLSearchParams({ date, limit: String(limit) });
  if (caller) params.set("caller", caller);
  return apiClient.get<TraceSummary[]>(`/api/traces/disk?${params}`);
}

export interface TraceDateList {
  dates: string[];
}

/** List YYYY-MM-DD folders that have on-disk traces (newest first). */
export function listTraceDates(): Promise<TraceDateList> {
  return apiClient.get<TraceDateList>("/api/traces/disk/dates");
}
