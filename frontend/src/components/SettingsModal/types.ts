export type TestStatus =
  | { status: "idle" }
  | { status: "running" }
  | { status: "ok"; latencyMs: number }
  | { status: "error"; error: string };

export type SettingsTab = "providers" | "general";

export interface ProviderConfig {
  name: string;
  type: "cloud" | "local";
  apiKey: string;
  apiKeySet: boolean;
  host: string;
  baseUrl: string;
  chatModel: string;
  embedModel: string;
  isDefault: boolean;
}

export const EMPTY_PROVIDER: ProviderConfig = {
  name: "",
  type: "cloud",
  apiKey: "",
  apiKeySet: false,
  host: "",
  baseUrl: "",
  chatModel: "",
  embedModel: "",
  isDefault: false,
};

export const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    ...EMPTY_PROVIDER,
    name: "openai",
    type: "cloud",
    chatModel: "gpt-4o",
    embedModel: "text-embedding-3-small",
    isDefault: true,
  },
  {
    ...EMPTY_PROVIDER,
    name: "anthropic",
    type: "cloud",
    chatModel: "claude-sonnet-4-20250514",
  },
  {
    ...EMPTY_PROVIDER,
    name: "ollama",
    type: "local",
    host: "http://localhost:11434",
    chatModel: "llama3",
    embedModel: "nomic-embed-text",
  },
];
