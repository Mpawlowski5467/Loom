import { apiClient } from "./client";
import type {
  ModelsResponse,
  ProviderConfigPublic,
  ProviderTestRequest,
  ProviderUpsert,
  ProvidersResponse,
  TestProviderResponse,
} from "./types";

export function listProviders(signal?: AbortSignal): Promise<ProvidersResponse> {
  return apiClient.get<ProvidersResponse>("/api/providers", signal);
}

export function upsertProvider(
  name: string,
  payload: ProviderUpsert,
  signal?: AbortSignal,
): Promise<ProviderConfigPublic> {
  return apiClient.put<ProviderConfigPublic>(
    `/api/providers/${encodeURIComponent(name)}`,
    payload,
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

export function deleteProvider(
  name: string,
  signal?: AbortSignal,
): Promise<void> {
  return apiClient.delete<void>(
    `/api/providers/${encodeURIComponent(name)}`,
    signal,
  );
}
