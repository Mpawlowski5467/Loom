import { apiClient } from "./client";

export interface AgentRegistryRecord {
  id: string;
  name: string;
  layer: "loom" | "shuttle";
  role: string;
  icon: string;
  system_prompt: string;
  system: boolean;
}

export interface CustomAgentPayload {
  name: string;
  role?: string;
  icon?: string;
  system_prompt?: string;
}

export function listAgentRegistry(): Promise<AgentRegistryRecord[]> {
  return apiClient.get<AgentRegistryRecord[]>("/api/agents/registry");
}

export function createCustomAgent(
  payload: CustomAgentPayload,
): Promise<AgentRegistryRecord> {
  return apiClient.post<AgentRegistryRecord>("/api/agents/registry", payload);
}

export function updateCustomAgent(
  id: string,
  payload: CustomAgentPayload,
): Promise<AgentRegistryRecord> {
  return apiClient.patch<AgentRegistryRecord>(
    `/api/agents/registry/${encodeURIComponent(id)}`,
    payload,
  );
}

export function deleteCustomAgent(id: string): Promise<void> {
  return apiClient.delete<void>(
    `/api/agents/registry/${encodeURIComponent(id)}`,
  );
}

export interface BubbleResponse {
  agent_id: string;
  bubble: string;
  cached: boolean;
}

export function getAgentBubble(
  id: string,
  signal?: AbortSignal,
): Promise<BubbleResponse> {
  return apiClient.get<BubbleResponse>(
    `/api/agents/registry/${encodeURIComponent(id)}/bubble`,
    signal,
  );
}
