import { apiClient } from "./client";

export interface AgentRegistryRecord {
  id: string;
  name: string;
  layer: "loom" | "shuttle";
  role: string;
  icon: string;
  system_prompt: string;
  system: boolean;
  /** Per-agent chat binding — empty string means "use the vault default". */
  provider: string;
  chat_model: string;
}

export interface CustomAgentPayload {
  name: string;
  role?: string;
  icon?: string;
  system_prompt?: string;
  provider?: string;
  chat_model?: string;
}

export function listAgentRegistry(): Promise<AgentRegistryRecord[]> {
  return apiClient.get<AgentRegistryRecord[]>("/api/agents/registry");
}

export function getAgentRegistry(id: string): Promise<AgentRegistryRecord> {
  return apiClient.get<AgentRegistryRecord>(
    `/api/agents/registry/${encodeURIComponent(id)}`,
  );
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
