import { describe, it, expect } from "vitest";
import {
  PROVIDERS,
  PROVIDER_BY_NAME,
  createProvider,
  toProviderInput,
  type ProviderName,
} from "./providerModels";

describe("PROVIDER_BY_NAME", () => {
  it("indexes every provider by name", () => {
    for (const p of PROVIDERS) {
      expect(PROVIDER_BY_NAME.get(p.name)).toBe(p);
    }
    expect(PROVIDER_BY_NAME.size).toBe(PROVIDERS.length);
  });
});

describe("createProvider", () => {
  it("seeds an OpenAI form with its chat + embed defaults", () => {
    const form = createProvider("openai");
    expect(form).toMatchObject({
      name: "openai",
      apiKey: "",
      apiKeySet: false,
      chatModel: "gpt-4o-mini",
      embedModel: "text-embedding-3-small",
    });
  });

  it("leaves embedModel blank for a chat-only provider", () => {
    expect(createProvider("codex").embedModel).toBe("");
    expect(createProvider("anthropic").embedModel).toBe("");
    expect(createProvider("xai").embedModel).toBe("");
  });

  it("uses the default host for a local provider", () => {
    expect(createProvider("ollama").host).toBe("http://localhost:11434");
  });

  it("starts cloud providers with an empty host", () => {
    expect(createProvider("openai").host).toBe("");
  });
});

describe("toProviderInput", () => {
  it("marks the provider as default only when it matches", () => {
    const form = createProvider("openai");
    expect(toProviderInput(form, "openai").is_default).toBe(true);
    expect(toProviderInput(form, "anthropic").is_default).toBe(false);
  });

  it("carries the api key, host, and chat model through", () => {
    const form = { ...createProvider("openai"), apiKey: "sk-123" };
    const input = toProviderInput(form, "openai");
    expect(input.api_key).toBe("sk-123");
    expect(input.chat_model).toBe("gpt-4o-mini");
    expect(input.type).toBe("cloud");
  });

  it("blanks base_url for providers that do not support it", () => {
    const form = { ...createProvider("openai"), baseUrl: "http://evil" };
    expect(toProviderInput(form, "openai").base_url).toBe("");
  });

  it("preserves base_url for an OpenAI-compatible provider", () => {
    const form = { ...createProvider("xai"), baseUrl: "https://custom/v1" };
    expect(toProviderInput(form, "xai").base_url).toBe("https://custom/v1");
  });

  it("blanks embed_model for a chat-only provider", () => {
    const form = { ...createProvider("anthropic"), embedModel: "leaked" };
    expect(toProviderInput(form, "anthropic").embed_model).toBe("");
  });

  it("keeps embed_model for an embed-capable provider", () => {
    const form = createProvider("ollama");
    expect(toProviderInput(form, "ollama").embed_model).toBe(
      "nomic-embed-text",
    );
  });
});

describe("provider metadata invariants", () => {
  it("only embed-capable providers ship embed models", () => {
    for (const p of PROVIDERS) {
      if (!p.supportsEmbed) expect(p.embedModels).toEqual([]);
      else expect(p.embedModels.length).toBeGreaterThan(0);
    }
  });

  it("base-url providers ship a default base url", () => {
    for (const p of PROVIDERS) {
      if (p.supportsBaseUrl) expect(p.defaultBaseUrl).not.toBe("");
    }
  });

  it("at least one provider supports embeddings", () => {
    const names = PROVIDERS.filter((p) => p.supportsEmbed).map((p) => p.name);
    expect(names).toContain("openai");
    expect(names as ProviderName[]).toContain("ollama");
  });

  it("only exposes OAuth labels for providers with a real delegated flow", () => {
    expect(PROVIDER_BY_NAME.get("codex")?.authMode).toBe("codex");
    expect(PROVIDER_BY_NAME.get("openrouter")?.authMode).toBe("oauth_pkce");
    expect(PROVIDER_BY_NAME.get("openai")?.authMode).toBe("api_key");
    expect(PROVIDER_BY_NAME.get("ollama")?.authMode).toBe("local");
  });

  it("gives every API-key provider an official credential link", () => {
    for (const provider of PROVIDERS) {
      if (provider.authMode === "api_key") {
        expect(provider.credentialUrl).toMatch(/^https:\/\//);
      }
    }
  });
});
