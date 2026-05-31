import type { SettingsProviderInput } from "../../api/settings";

export type ProviderName =
  | "openai"
  | "anthropic"
  | "xai"
  | "openrouter"
  | "ollama";

export interface ProviderMeta {
  name: ProviderName;
  label: string;
  type: "cloud" | "local";
  defaultChat: string;
  defaultEmbed: string;
  defaultHost: string;
  chatModels: string[];
  embedModels: string[];
  supportsEmbed: boolean;
  /** OpenAI-compatible providers expose a custom API endpoint. */
  supportsBaseUrl: boolean;
  /** Placeholder shown when base_url is blank — the provider's hosted default. */
  defaultBaseUrl: string;
}

export interface ProviderForm {
  name: ProviderName;
  apiKey: string;
  apiKeySet: boolean;
  host: string;
  baseUrl: string;
  chatModel: string;
  embedModel: string;
}

export const PROVIDERS: ProviderMeta[] = [
  {
    name: "openai",
    label: "OpenAI",
    type: "cloud",
    defaultChat: "gpt-4o-mini",
    defaultEmbed: "text-embedding-3-small",
    defaultHost: "",
    chatModels: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"],
    embedModels: ["text-embedding-3-small", "text-embedding-3-large"],
    supportsEmbed: true,
    supportsBaseUrl: false,
    defaultBaseUrl: "",
  },
  {
    name: "anthropic",
    label: "Anthropic",
    type: "cloud",
    defaultChat: "claude-sonnet-4-20250514",
    defaultEmbed: "",
    defaultHost: "",
    chatModels: ["claude-sonnet-4-20250514", "claude-3-5-haiku-latest"],
    embedModels: [],
    supportsEmbed: false,
    supportsBaseUrl: false,
    defaultBaseUrl: "",
  },
  {
    name: "xai",
    label: "xAI",
    type: "cloud",
    defaultChat: "grok-3",
    defaultEmbed: "",
    defaultHost: "",
    chatModels: ["grok-3", "grok-2-latest"],
    embedModels: [],
    supportsEmbed: false,
    supportsBaseUrl: true,
    defaultBaseUrl: "https://api.x.ai/v1",
  },
  {
    name: "openrouter",
    label: "OpenRouter",
    type: "cloud",
    defaultChat: "google/gemma-4-31b-it:free",
    defaultEmbed: "",
    defaultHost: "",
    // Free models that suit Loom's multi-agent Council — good instruction-
    // following + reasonable speed, ordered best-first. All ":free" models
    // share OpenRouter's per-account daily cap; you can still type any paid
    // model id here. Embeddings stay on a separate provider (ollama/openai).
    chatModels: [
      "google/gemma-4-31b-it:free",
      "openai/gpt-oss-20b:free",
      "qwen/qwen3-next-80b-a3b-instruct:free",
      "openai/gpt-oss-120b:free",
      "google/gemma-4-26b-a4b-it:free",
      "deepseek/deepseek-v4-flash:free",
      "moonshotai/kimi-k2.6:free",
      "meta-llama/llama-3.3-70b-instruct:free",
    ],
    embedModels: [],
    supportsEmbed: false,
    supportsBaseUrl: true,
    defaultBaseUrl: "https://openrouter.ai/api/v1",
  },
  {
    name: "ollama",
    label: "Ollama",
    type: "local",
    defaultChat: "llama3",
    defaultEmbed: "nomic-embed-text",
    defaultHost: "http://localhost:11434",
    chatModels: ["llama3", "llama3.1", "mistral", "qwen2.5"],
    embedModels: ["nomic-embed-text", "mxbai-embed-large"],
    supportsEmbed: true,
    supportsBaseUrl: false,
    defaultBaseUrl: "",
  },
];

export const PROVIDER_BY_NAME = new Map(PROVIDERS.map((p) => [p.name, p]));

export function createProvider(name: ProviderName): ProviderForm {
  const meta = PROVIDER_BY_NAME.get(name)!;
  return {
    name,
    apiKey: "",
    apiKeySet: false,
    host: meta.defaultHost,
    baseUrl: "",
    chatModel: meta.defaultChat,
    embedModel: meta.supportsEmbed ? meta.defaultEmbed : "",
  };
}

export function toProviderInput(
  provider: ProviderForm,
  defaultProvider: ProviderName,
): SettingsProviderInput {
  const meta = PROVIDER_BY_NAME.get(provider.name)!;
  return {
    name: provider.name,
    type: meta.type,
    api_key: provider.apiKey,
    host: provider.host,
    base_url: meta.supportsBaseUrl ? provider.baseUrl : "",
    chat_model: provider.chatModel,
    embed_model: meta.supportsEmbed ? provider.embedModel : "",
    is_default: provider.name === defaultProvider,
  };
}
