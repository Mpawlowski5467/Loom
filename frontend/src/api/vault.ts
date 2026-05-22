import { apiClient } from "./client";
import type {
  VaultCreateRequest,
  VaultExistsResponse,
  VaultInfo,
} from "./types";

export function getVault(signal?: AbortSignal): Promise<VaultInfo> {
  return apiClient.get<VaultInfo>("/api/vault", signal);
}

export function vaultExists(
  name: string,
  signal?: AbortSignal,
): Promise<VaultExistsResponse> {
  return apiClient.get<VaultExistsResponse>(
    `/api/vault/exists?name=${encodeURIComponent(name)}`,
    signal,
  );
}

export function createVault(
  payload: VaultCreateRequest,
  signal?: AbortSignal,
): Promise<VaultInfo> {
  return apiClient.post<VaultInfo>("/api/vault", payload, signal);
}
