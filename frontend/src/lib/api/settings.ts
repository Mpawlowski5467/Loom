import { request } from "./common";

export interface ProviderInput {
  name: string;
  type: "cloud" | "local";
  apiKey: string;
  host: string;
  baseUrl: string;
  chatModel: string;
  embedModel: string;
  isDefault: boolean;
}

export interface SaveProvidersRequest {
  providers: Array<{
    name: string;
    type: string;
    api_key: string;
    host: string;
    base_url: string;
    chat_model: string;
    embed_model: string;
    is_default: boolean;
  }>;
}

export interface SaveProvidersResponse {
  saved: number;
  default_chat_provider: string | null;
  default_embed_provider: string | null;
}

export interface ProviderOutput {
  name: string;
  type: "cloud" | "local";
  apiKey: string;
  apiKeySet: boolean;
  host: string;
  baseUrl: string;
  chatModel: string;
  embedModel: string;
  isDefaultChat: boolean;
  isDefaultEmbed: boolean;
}

export interface GetProvidersResponse {
  providers: ProviderOutput[];
  activeVault: string;
}

interface ProviderOutputWire {
  name: string;
  type: "cloud" | "local";
  api_key: string;
  api_key_set: boolean;
  host: string;
  base_url: string;
  chat_model: string;
  embed_model: string;
  is_default_chat: boolean;
  is_default_embed: boolean;
}

interface GetProvidersResponseWire {
  providers: ProviderOutputWire[];
  active_vault: string;
}

export async function loadProviderSettings(): Promise<GetProvidersResponse> {
  const wire = await request<GetProvidersResponseWire>("/api/settings/providers");
  return {
    activeVault: wire.active_vault,
    providers: wire.providers.map((p) => ({
      name: p.name,
      type: p.type,
      apiKey: p.api_key,
      apiKeySet: p.api_key_set,
      host: p.host,
      baseUrl: p.base_url,
      chatModel: p.chat_model,
      embedModel: p.embed_model,
      isDefaultChat: p.is_default_chat,
      isDefaultEmbed: p.is_default_embed,
    })),
  };
}

export function saveProviderSettings(providers: ProviderInput[]): Promise<SaveProvidersResponse> {
  const payload: SaveProvidersRequest = {
    providers: providers.map((p) => ({
      name: p.name,
      type: p.type,
      api_key: p.apiKey,
      host: p.host,
      base_url: p.baseUrl,
      chat_model: p.chatModel,
      embed_model: p.embedModel,
      is_default: p.isDefault,
    })),
  };
  return request<SaveProvidersResponse>("/api/settings/providers", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export interface TestProviderResponse {
  ok: boolean;
  latencyMs: number;
  error: string;
}

interface TestProviderResponseWire {
  ok: boolean;
  latency_ms: number;
  error: string;
}

export async function testProviderConnection(
  provider: ProviderInput,
): Promise<TestProviderResponse> {
  const wire = await request<TestProviderResponseWire>(
    `/api/settings/providers/${encodeURIComponent(provider.name)}/test`,
    {
      method: "POST",
      body: JSON.stringify({
        name: provider.name,
        type: provider.type,
        api_key: provider.apiKey,
        host: provider.host,
        base_url: provider.baseUrl,
        chat_model: provider.chatModel,
        embed_model: provider.embedModel,
        is_default: provider.isDefault,
      }),
    },
  );
  return { ok: wire.ok, latencyMs: wire.latency_ms, error: wire.error };
}
