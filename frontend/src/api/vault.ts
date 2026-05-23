import { apiClient } from "./client";
import type {
  ActiveVaultResponse,
  ArchiveVaultResponse,
  VaultCreateRequest,
  VaultExistsResponse,
  VaultInfo,
  VaultListResponse,
} from "./types";

export function getVault(signal?: AbortSignal): Promise<ActiveVaultResponse> {
  return apiClient.get<ActiveVaultResponse>("/api/vaults/active", signal);
}

export function listVaults(signal?: AbortSignal): Promise<VaultListResponse> {
  return apiClient.get<VaultListResponse>("/api/vaults", signal);
}

export function vaultExists(
  name: string,
  signal?: AbortSignal,
): Promise<VaultExistsResponse> {
  return apiClient.get<VaultExistsResponse>(
    `/api/vaults/exists?name=${encodeURIComponent(name)}`,
    signal,
  );
}

export function createVault(
  payload: VaultCreateRequest,
  signal?: AbortSignal,
): Promise<VaultInfo> {
  return apiClient.post<VaultInfo>("/api/vaults", payload, signal);
}

export function setActiveVault(
  name: string,
  signal?: AbortSignal,
): Promise<ActiveVaultResponse> {
  return apiClient.put<ActiveVaultResponse>(
    "/api/vaults/active",
    { name },
    signal,
  );
}

export function revealVault(
  name: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; path: string }> {
  return apiClient.post<{ ok: boolean; path: string }>(
    `/api/vaults/${encodeURIComponent(name)}/reveal`,
    {},
    signal,
  );
}

export function archiveVault(
  name: string,
  signal?: AbortSignal,
): Promise<ArchiveVaultResponse> {
  return apiClient.post<ArchiveVaultResponse>(
    `/api/vaults/${encodeURIComponent(name)}/archive`,
    {},
    signal,
  );
}

export function renameVault(
  name: string,
  newName: string,
  signal?: AbortSignal,
): Promise<VaultInfo> {
  return apiClient.patch<VaultInfo>(
    `/api/vaults/${encodeURIComponent(name)}`,
    { new_name: newName },
    signal,
  );
}
