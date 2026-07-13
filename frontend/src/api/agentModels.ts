import { apiClient } from "./client";
import type {
  AgentModelOverrideInput,
  AgentModelsResponse,
  PutAgentModelsRequest,
} from "./types";

export function getAgentModels(
  signal?: AbortSignal,
): Promise<AgentModelsResponse> {
  return apiClient.get<AgentModelsResponse>(
    "/api/settings/agent-models",
    signal,
  );
}

/**
 * Replace the full per-agent override map. The backend rebinds agents
 * immediately, so the change takes effect without a restart.
 */
export function putAgentModels(
  overrides: Record<string, AgentModelOverrideInput>,
  signal?: AbortSignal,
): Promise<AgentModelsResponse> {
  const body: PutAgentModelsRequest = { overrides };
  return apiClient.put<AgentModelsResponse>(
    "/api/settings/agent-models",
    body,
    signal,
  );
}

/** Replace built-in overrides while preserving custom-agent bindings. */
export function putSystemAgentModels(
  overrides: Record<string, AgentModelOverrideInput>,
  signal?: AbortSignal,
): Promise<AgentModelsResponse> {
  const body: PutAgentModelsRequest = { overrides, scope: "system" };
  return apiClient.put<AgentModelsResponse>(
    "/api/settings/agent-models",
    body,
    signal,
  );
}
