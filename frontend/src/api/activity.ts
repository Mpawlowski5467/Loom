import { apiClient } from "./client";

export interface AgentActivity {
  name: string;
  state: "running" | "idle";
  inflight: number;
  action_count: number;
  last_started_age_s: number | null;
  last_finished_age_s: number | null;
  pulse: number[];
}

export function fetchAgentActivity(
  signal?: AbortSignal,
): Promise<AgentActivity[]> {
  return apiClient.get<AgentActivity[]>("/api/agents/activity", signal);
}
