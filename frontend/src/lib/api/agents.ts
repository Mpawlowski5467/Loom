import { request } from "./common";

export interface AgentStatus {
  name: string;
  role: string;
  enabled: boolean;
  trust_level: string;
  action_count: number;
  last_action: string | null;
}

export interface ChangelogEntry {
  agent: string;
  date: string;
  content: string;
}

export interface RunResult {
  agent: string;
  result: Record<string, unknown>;
}

export function fetchAgents(): Promise<AgentStatus[]> {
  return request<AgentStatus[]>("/api/agents");
}

export function runAgent(name: string): Promise<RunResult> {
  return request<RunResult>(`/api/agents/${encodeURIComponent(name)}/run`, {
    method: "POST",
  });
}

export function fetchChangelog(agent: string, date?: string): Promise<ChangelogEntry> {
  const query = new URLSearchParams({ agent });
  if (date) query.set("date", date);
  return request<ChangelogEntry>(`/api/changelog?${query.toString()}`);
}
