import { apiClient } from "./client";
import type {
  CodexAuthStatus,
  CodexLoginStartResponse,
  ModelsResponse,
  ProviderTestRequest,
  ProviderOAuthStartResponse,
  TestProviderResponse,
} from "./types";

export function getCodexAuthStatus(
  signal?: AbortSignal,
): Promise<CodexAuthStatus> {
  return apiClient.get<CodexAuthStatus>(
    "/api/providers/codex/auth/status",
    signal,
  );
}

export function startCodexLogin(
  signal?: AbortSignal,
): Promise<CodexLoginStartResponse> {
  return apiClient.post<CodexLoginStartResponse>(
    "/api/providers/codex/auth/start",
    {},
    signal,
  );
}

export function startOpenRouterOAuth(
  signal?: AbortSignal,
): Promise<ProviderOAuthStartResponse> {
  return apiClient.post<ProviderOAuthStartResponse>(
    "/api/providers/openrouter/oauth/start",
    {},
    signal,
  );
}

export function testProvider(
  name: string,
  payload: ProviderTestRequest = {},
  signal?: AbortSignal,
): Promise<TestProviderResponse> {
  return apiClient.post<TestProviderResponse>(
    `/api/providers/${encodeURIComponent(name)}/test`,
    payload,
    signal,
  );
}

export function listModels(
  name: string,
  type: "chat" | "embed" | "all" = "all",
  signal?: AbortSignal,
): Promise<ModelsResponse> {
  return apiClient.get<ModelsResponse>(
    `/api/providers/${encodeURIComponent(name)}/models?type=${type}`,
    signal,
  );
}
