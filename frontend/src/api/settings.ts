import { apiClient } from "./client";

export interface SettingsProvider {
  name: string;
  type: string;
  api_key: string;
  api_key_set: boolean;
  host: string;
  base_url: string;
  chat_model: string;
  embed_model: string;
  is_default_chat: boolean;
  is_default_embed: boolean;
}

export interface SettingsProvidersResponse {
  providers: SettingsProvider[];
  active_vault: string;
}

export interface SettingsProviderInput {
  name: string;
  type: string;
  api_key: string;
  host: string;
  base_url: string;
  chat_model: string;
  embed_model: string;
  is_default: boolean;
}

export interface SaveProvidersResponse {
  saved: number;
  default_chat_provider: string | null;
  default_embed_provider: string | null;
}

export function getSettingsProviders(
  signal?: AbortSignal,
): Promise<SettingsProvidersResponse> {
  return apiClient.get<SettingsProvidersResponse>(
    "/api/settings/providers",
    signal,
  );
}

export function saveSettingsProviders(
  providers: SettingsProviderInput[],
  signal?: AbortSignal,
): Promise<SaveProvidersResponse> {
  return apiClient.post<SaveProvidersResponse>(
    "/api/settings/providers",
    { providers },
    signal,
  );
}
