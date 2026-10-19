import type { OnboardingProviderPayload } from "@/api/types";

export interface DraftPatch {
  providers?: OnboardingProviderPayload[];
  chatProvider?: string | null;
  embedProvider?: string | null;
}

type ProviderName =
  | "openai"
  | "anthropic"
  | "xai"
  | "openrouter"
  | "moonshot"
  | "ollama";

export interface ProviderOption {
  name: ProviderName;
  label: string;
  requiresApiKey: boolean;
  requiresHost: boolean;
  hint: string;
  defaultChat?: string;
  defaultEmbed?: string;
  defaultHost?: string;
}

export const PROVIDERS: ProviderOption[] = [
  {
    name: "openai",
    label: "OpenAI",
    requiresApiKey: true,
    requiresHost: false,
    hint: "Get a key at platform.openai.com/api-keys.",
    defaultChat: "gpt-4o-mini",
    defaultEmbed: "text-embedding-3-small",
  },
  {
    name: "anthropic",
    label: "Anthropic",
    requiresApiKey: true,
    requiresHost: false,
    hint: "console.anthropic.com → settings → API keys.",
    defaultChat: "claude-sonnet-4-6-20251001",
  },
  {
    name: "xai",
    label: "xAI",
    requiresApiKey: true,
    requiresHost: false,
    hint: "console.x.ai for keys.",
    defaultChat: "grok-2-latest",
  },
  {
    name: "openrouter",
    label: "OpenRouter",
    requiresApiKey: true,
    requiresHost: false,
    hint: "openrouter.ai/keys — one key, every model.",
    defaultChat: "openai/gpt-4o-mini",
  },
  {
    name: "moonshot",
    label: "Moonshot (Kimi)",
    requiresApiKey: true,
    requiresHost: false,
    hint: "Connect your Moonshot developer account with an API key.",
    defaultChat: "kimi-k2.6",
  },
  {
    name: "ollama",
    label: "Ollama (local)",
    requiresApiKey: false,
    requiresHost: true,
    hint: "Runs locally. Pull a model with `ollama pull llama3`.",
    defaultChat: "llama3",
    defaultEmbed: "nomic-embed-text",
    defaultHost: "http://localhost:11434",
  },
];

const META_BY_NAME = new Map(PROVIDERS.map((p) => [p.name, p]));

export function providerMeta(name: string): ProviderOption | undefined {
  return META_BY_NAME.get(name as ProviderName);
}

function defaultPayload(opt: ProviderOption): OnboardingProviderPayload {
  return {
    name: opt.name,
    api_key: "",
    chat_model: opt.defaultChat ?? "",
    embed_model: opt.defaultEmbed ?? "",
    host: opt.defaultHost ?? "",
  };
}

/**
 * Add or remove a provider from the draft, moving the chat/embed defaults
 * off a removed provider and onto a fitting one.
 */
export function togglePatch(
  opt: ProviderOption,
  providers: OnboardingProviderPayload[],
  chatProvider: string | null,
  embedProvider: string | null,
): DraftPatch {
  if (providers.some((p) => p.name === opt.name)) {
    const next = providers.filter((p) => p.name !== opt.name);
    const patch: DraftPatch = { providers: next };
    if (chatProvider === opt.name) patch.chatProvider = next[0]?.name ?? null;
    if (embedProvider === opt.name)
      patch.embedProvider =
        next.find((p) => providerMeta(p.name)?.defaultEmbed)?.name ??
        next[0]?.name ??
        null;
    return patch;
  }
  const patch: DraftPatch = { providers: [...providers, defaultPayload(opt)] };
  if (!chatProvider) patch.chatProvider = opt.name;
  if (!embedProvider && opt.defaultEmbed) patch.embedProvider = opt.name;
  return patch;
}
