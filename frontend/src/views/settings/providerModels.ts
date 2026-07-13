import type { ReactNode } from "react";
import type { SettingsProviderInput } from "../../api/settings";
import {
  AnthropicIcon,
  DeepSeekIcon,
  GeminiIcon,
  GroqIcon,
  MistralIcon,
  OllamaIcon,
  OpenAIIcon,
  OpenRouterIcon,
  TogetherIcon,
  XaiIcon,
} from "../../components/icons/providers";

export type ProviderName =
  | "codex"
  | "openai"
  | "anthropic"
  | "xai"
  | "openrouter"
  | "ollama"
  | "groq"
  | "deepseek"
  | "together"
  | "mistral"
  | "gemini";

/** Inline-SVG icon component used for a provider (tinted via currentColor). */
export type ProviderIcon = (props: {
  size?: number;
  className?: string;
}) => ReactNode;

export interface ProviderMeta {
  name: ProviderName;
  label: string;
  type: "cloud" | "local";
  /** Brand icon, rendered in the provider list + accordion header. */
  icon: ProviderIcon;
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
  /** Truthful credential ceremony exposed by Loom's Settings UI. */
  authMode: "api_key" | "oauth_pkce" | "local" | "codex";
  /** Official account/key page for providers that do not expose app OAuth. */
  credentialUrl: string;
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
    name: "codex",
    label: "Codex (ChatGPT)",
    type: "local",
    icon: OpenAIIcon,
    defaultChat: "default",
    defaultEmbed: "",
    defaultHost: "",
    chatModels: ["default"],
    embedModels: [],
    supportsEmbed: false,
    supportsBaseUrl: false,
    defaultBaseUrl: "",
    authMode: "codex",
    credentialUrl: "https://chatgpt.com/",
  },
  {
    name: "openai",
    label: "OpenAI",
    type: "cloud",
    icon: OpenAIIcon,
    defaultChat: "gpt-4o-mini",
    defaultEmbed: "text-embedding-3-small",
    defaultHost: "",
    chatModels: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"],
    embedModels: ["text-embedding-3-small", "text-embedding-3-large"],
    supportsEmbed: true,
    supportsBaseUrl: false,
    defaultBaseUrl: "",
    authMode: "api_key",
    credentialUrl: "https://platform.openai.com/api-keys",
  },
  {
    name: "anthropic",
    label: "Anthropic",
    type: "cloud",
    icon: AnthropicIcon,
    defaultChat: "claude-sonnet-4-20250514",
    defaultEmbed: "",
    defaultHost: "",
    chatModels: ["claude-sonnet-4-20250514", "claude-3-5-haiku-latest"],
    embedModels: [],
    supportsEmbed: false,
    supportsBaseUrl: false,
    defaultBaseUrl: "",
    authMode: "api_key",
    credentialUrl: "https://platform.claude.com/settings/keys",
  },
  {
    name: "xai",
    label: "xAI",
    type: "cloud",
    icon: XaiIcon,
    defaultChat: "grok-3",
    defaultEmbed: "",
    defaultHost: "",
    chatModels: ["grok-3", "grok-2-latest"],
    embedModels: [],
    supportsEmbed: false,
    supportsBaseUrl: true,
    defaultBaseUrl: "https://api.x.ai/v1",
    authMode: "api_key",
    credentialUrl: "https://console.x.ai/",
  },
  {
    name: "openrouter",
    label: "OpenRouter",
    type: "cloud",
    icon: OpenRouterIcon,
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
    authMode: "oauth_pkce",
    credentialUrl: "https://openrouter.ai/settings/keys",
  },
  {
    name: "ollama",
    label: "Ollama",
    type: "local",
    icon: OllamaIcon,
    defaultChat: "llama3",
    defaultEmbed: "nomic-embed-text",
    defaultHost: "http://localhost:11434",
    chatModels: ["llama3", "llama3.1", "mistral", "qwen2.5"],
    embedModels: ["nomic-embed-text", "mxbai-embed-large"],
    supportsEmbed: true,
    supportsBaseUrl: false,
    defaultBaseUrl: "",
    authMode: "local",
    credentialUrl: "https://ollama.com/download",
  },
  {
    name: "groq",
    label: "Groq",
    type: "cloud",
    icon: GroqIcon,
    defaultChat: "llama-3.3-70b-versatile",
    defaultEmbed: "",
    defaultHost: "",
    chatModels: [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "moonshotai/kimi-k2-instruct",
      "openai/gpt-oss-120b",
    ],
    embedModels: [],
    supportsEmbed: false,
    supportsBaseUrl: true,
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    authMode: "api_key",
    credentialUrl: "https://console.groq.com/keys",
  },
  {
    name: "deepseek",
    label: "DeepSeek",
    type: "cloud",
    icon: DeepSeekIcon,
    defaultChat: "deepseek-chat",
    defaultEmbed: "",
    defaultHost: "",
    chatModels: ["deepseek-chat", "deepseek-reasoner"],
    embedModels: [],
    supportsEmbed: false,
    supportsBaseUrl: true,
    defaultBaseUrl: "https://api.deepseek.com/v1",
    authMode: "api_key",
    credentialUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    name: "together",
    label: "Together AI",
    type: "cloud",
    icon: TogetherIcon,
    defaultChat: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    defaultEmbed: "BAAI/bge-base-en-v1.5",
    defaultHost: "",
    chatModels: [
      "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      "Qwen/Qwen2.5-72B-Instruct-Turbo",
      "deepseek-ai/DeepSeek-V3",
      "mistralai/Mixtral-8x7B-Instruct-v0.1",
    ],
    embedModels: ["BAAI/bge-base-en-v1.5", "BAAI/bge-large-en-v1.5"],
    supportsEmbed: true,
    supportsBaseUrl: true,
    defaultBaseUrl: "https://api.together.xyz/v1",
    authMode: "api_key",
    credentialUrl: "https://api.together.ai/settings/api-keys",
  },
  {
    name: "mistral",
    label: "Mistral",
    type: "cloud",
    icon: MistralIcon,
    defaultChat: "mistral-large-latest",
    defaultEmbed: "mistral-embed",
    defaultHost: "",
    chatModels: [
      "mistral-large-latest",
      "mistral-small-latest",
      "open-mistral-nemo",
      "codestral-latest",
    ],
    embedModels: ["mistral-embed"],
    supportsEmbed: true,
    supportsBaseUrl: true,
    defaultBaseUrl: "https://api.mistral.ai/v1",
    authMode: "api_key",
    credentialUrl: "https://console.mistral.ai/api-keys",
  },
  {
    name: "gemini",
    label: "Google Gemini",
    type: "cloud",
    icon: GeminiIcon,
    defaultChat: "gemini-2.0-flash",
    defaultEmbed: "text-embedding-004",
    defaultHost: "",
    chatModels: [
      "gemini-2.0-flash",
      "gemini-2.0-flash-lite",
      "gemini-1.5-pro",
      "gemini-1.5-flash",
    ],
    embedModels: ["text-embedding-004"],
    supportsEmbed: true,
    supportsBaseUrl: true,
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
    authMode: "api_key",
    credentialUrl: "https://aistudio.google.com/apikey",
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
