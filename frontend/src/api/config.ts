import { apiClient } from "./client";
import type { ConfigPatch, LoomConfigPublic } from "./types";

export function getConfig(signal?: AbortSignal): Promise<LoomConfigPublic> {
  return apiClient.get<LoomConfigPublic>("/api/config", signal);
}

export function patchConfig(
  patch: ConfigPatch,
  signal?: AbortSignal,
): Promise<LoomConfigPublic> {
  return apiClient.patch<LoomConfigPublic>("/api/config", patch, signal);
}
