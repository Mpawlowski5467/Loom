import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "./client";
import {
  getCodexAuthStatus,
  listModels,
  startCodexLogin,
  startOpenRouterOAuth,
  testProvider,
} from "./providers";
import type { ModelsResponse } from "./types";

afterEach(() => {
  vi.restoreAllMocks();
});

const models: ModelsResponse = {
  chat: [{ id: "llama3.1:8b", name: "llama3.1:8b", type: "chat" }],
  embed: [{ id: "nomic-embed-text", name: "nomic-embed-text", type: "embed" }],
};

describe("listModels", () => {
  it("GETs the provider's models endpoint (defaults to all)", async () => {
    const spy = vi.spyOn(apiClient, "get").mockResolvedValue(models);
    const res = await listModels("ollama");
    expect(spy).toHaveBeenCalledWith(
      "/api/providers/ollama/models?type=all",
      undefined,
    );
    expect(res.chat.map((m) => m.id)).toEqual(["llama3.1:8b"]);
    expect(res.embed.map((m) => m.id)).toEqual(["nomic-embed-text"]);
  });

  it("passes an explicit capability filter and escapes the name", async () => {
    const spy = vi.spyOn(apiClient, "get").mockResolvedValue(models);
    await listModels("open router", "chat");
    expect(spy).toHaveBeenCalledWith(
      "/api/providers/open%20router/models?type=chat",
      undefined,
    );
  });
});

describe("testProvider", () => {
  it("POSTs credentials to the test endpoint", async () => {
    const spy = vi
      .spyOn(apiClient, "post")
      .mockResolvedValue({ ok: true, latency_ms: 42, error: null });
    const res = await testProvider("openai", { api_key: "sk-x" });
    expect(spy).toHaveBeenCalledWith(
      "/api/providers/openai/test",
      { api_key: "sk-x" },
      undefined,
    );
    expect(res.ok).toBe(true);
  });
});

describe("provider auth", () => {
  it("reads Codex's local auth status without handling credentials", async () => {
    const status = {
      installed: true,
      connected: true,
      auth_mode: "chatgpt",
      plan_type: "plus",
      version: "0.142.4",
      error: null,
    };
    const spy = vi.spyOn(apiClient, "get").mockResolvedValue(status);
    expect(await getCodexAuthStatus()).toEqual(status);
    expect(spy).toHaveBeenCalledWith(
      "/api/providers/codex/auth/status",
      undefined,
    );
  });

  it("starts the delegated Codex browser login", async () => {
    const response = {
      auth_url: "https://chatgpt.com/auth",
      login_id: "login-1",
    };
    const spy = vi.spyOn(apiClient, "post").mockResolvedValue(response);
    expect(await startCodexLogin()).toEqual(response);
    expect(spy).toHaveBeenCalledWith(
      "/api/providers/codex/auth/start",
      {},
      undefined,
    );
  });

  it("starts OpenRouter PKCE without exposing a verifier", async () => {
    const response = {
      authorization_url: "https://openrouter.ai/auth?code_challenge=x",
      expires_in: 600,
    };
    const spy = vi.spyOn(apiClient, "post").mockResolvedValue(response);
    expect(await startOpenRouterOAuth()).toEqual(response);
    expect(spy).toHaveBeenCalledWith(
      "/api/providers/openrouter/oauth/start",
      {},
      undefined,
    );
  });
});
