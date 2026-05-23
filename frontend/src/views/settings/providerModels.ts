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
}

export interface ProviderForm {
  name: ProviderName;
  apiKey: string;
  apiKeySet: boolean;
  host: string;
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
  },
  {
    name: "openrouter",
    label: "OpenRouter",
    type: "cloud",
    defaultChat: "openai/gpt-4o-mini",
    defaultEmbed: "",
    defaultHost: "",
    chatModels: [
      "openai/gpt-4o-mini",
      "openai/gpt-4o",
      "anthropic/claude-3.5-sonnet",
      "anthropic/claude-3.5-haiku",
      "meta-llama/llama-3.3-70b-instruct",
      "google/gemini-2.0-flash-001",
    ],
    embedModels: [],
    supportsEmbed: false,
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
    base_url: "",
    chat_model: provider.chatModel,
    embed_model: meta.supportsEmbed ? provider.embedModel : "",
    is_default: provider.name === defaultProvider,
  };
}
