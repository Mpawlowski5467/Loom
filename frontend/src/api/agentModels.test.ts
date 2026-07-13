import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "./client";
import {
  getAgentModels,
  putAgentModels,
  putSystemAgentModels,
} from "./agentModels";
import type { AgentModelsResponse } from "./types";

afterEach(() => {
  vi.restoreAllMocks();
});

const response: AgentModelsResponse = {
  agents: [
    {
      id: "weaver",
      name: "Weaver",
      icon: "🕸",
      layer: "loom",
      system: true,
      provider: "",
      chat_model: "",
      role: "creates notes",
      uses_model: true,
    },
  ],
  default_provider: "openai",
};

describe("getAgentModels", () => {
  it("fetches every agent's binding", async () => {
    const spy = vi.spyOn(apiClient, "get").mockResolvedValue(response);
    const res = await getAgentModels();
    expect(spy).toHaveBeenCalledWith("/api/settings/agent-models", undefined);
    expect(res.agents[0]!.id).toBe("weaver");
    expect(res.default_provider).toBe("openai");
  });
});

describe("putAgentModels", () => {
  it("PUTs the full override map wrapped in { overrides }", async () => {
    const spy = vi.spyOn(apiClient, "put").mockResolvedValue(response);
    const overrides = {
      weaver: { provider: "ollama", chat_model: "llama3.1:8b" },
    };
    await putAgentModels(overrides);
    expect(spy).toHaveBeenCalledWith(
      "/api/settings/agent-models",
      { overrides },
      undefined,
    );
  });

  it("accepts an empty map to clear all overrides", async () => {
    const spy = vi.spyOn(apiClient, "put").mockResolvedValue(response);
    await putAgentModels({});
    expect(spy).toHaveBeenCalledWith(
      "/api/settings/agent-models",
      { overrides: {} },
      undefined,
    );
  });
});

describe("putSystemAgentModels", () => {
  it("scopes replacement to built-in bindings", async () => {
    const spy = vi.spyOn(apiClient, "put").mockResolvedValue(response);
    const overrides = {
      sentinel: { provider: "ollama", chat_model: "gpt-oss:20b" },
    };
    await putSystemAgentModels(overrides);
    expect(spy).toHaveBeenCalledWith(
      "/api/settings/agent-models",
      { overrides, scope: "system" },
      undefined,
    );
  });
});
