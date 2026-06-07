import { apiClient } from "./client";
import type { TraceDetail } from "./traces";

/** One node's execution within a multi-step agent run. */
export interface RunStep {
  name: string;
  status: string; // "ok" | "error"
  duration_ms: number;
  trace_ids: string[];
  error: string;
}

/** The shape of a multi-step agent run (its ordered steps). */
export interface RunSummary {
  run_id: string;
  agent: string;
  status: string; // "ok" | "error"
  started: string;
  ended: string;
  duration_ms: number;
  steps: RunStep[];
}

/** A run plus the full trace record for each step's LLM calls, keyed by step name. */
export interface RunDetail extends RunSummary {
  traces: Record<string, TraceDetail[]>;
}

/** List recent multi-step agent runs, newest first. */
export function listRuns(limit: number = 50): Promise<RunSummary[]> {
  return apiClient.get<RunSummary[]>(`/api/traces/runs?limit=${limit}`);
}

/** Fetch one run with the full trace record for each step. */
export function fetchRun(runId: string): Promise<RunDetail> {
  return apiClient.get<RunDetail>(`/api/traces/runs/${runId}`);
}
