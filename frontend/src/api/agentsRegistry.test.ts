import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "./client";
import {
  createCustomAgent,
  deleteCustomAgent,
  getAgentRegistry,
  listAgentRegistry,
  updateCustomAgent,
  type AgentRegistryRecord,
} from "./agentsRegistry";

afterEach(() => {
  vi.restoreAllMocks();
});

function mkRecord(overrides: Partial<AgentRegistryRecord> = {}): AgentRegistryRecord {
  return {
    id: "scout",
    name: "Scout",
    layer: "shuttle",
    role: "finds things",
    icon: "✦",
    system_prompt: "You are Scout.",
    system: false,
    provider: "",
    chat_model: "",
    ...overrides,
  };
}

describe("listAgentRegistry", () => {
  it("fetches the registry list", async () => {
    const spy = vi.spyOn(apiClient, "get").mockResolvedValue([mkRecord()]);
    const records = await listAgentRegistry();
    expect(spy).toHaveBeenCalledWith("/api/agents/registry");
    expect(records[0]!.id).toBe("scout");
  });
});

describe("getAgentRegistry", () => {
  it("fetches one record including the system prompt and model override", async () => {
    const spy = vi
      .spyOn(apiClient, "get")
      .mockResolvedValue(mkRecord({ provider: "openai", chat_model: "gpt-4o" }));
    const record = await getAgentRegistry("scout");
    expect(spy).toHaveBeenCalledWith("/api/agents/registry/scout");
    expect(record.system_prompt).toBe("You are Scout.");
    expect(record.provider).toBe("openai");
    expect(record.chat_model).toBe("gpt-4o");
  });

  it("URL-encodes the agent id", async () => {
    const spy = vi.spyOn(apiClient, "get").mockResolvedValue(mkRecord());
    await getAgentRegistry("a b/c");
    expect(spy).toHaveBeenCalledWith("/api/agents/registry/a%20b%2Fc");
  });
});

describe("createCustomAgent", () => {
  it("POSTs the payload including provider and chat_model", async () => {
    const spy = vi.spyOn(apiClient, "post").mockResolvedValue(mkRecord());
    await createCustomAgent({
      name: "Scout",
      role: "finds things",
      icon: "⚡",
      system_prompt: "You are Scout.",
      provider: "openai",
      chat_model: "gpt-4o-mini",
    });
    expect(spy).toHaveBeenCalledWith("/api/agents/registry", {
      name: "Scout",
      role: "finds things",
      icon: "⚡",
      system_prompt: "You are Scout.",
      provider: "openai",
      chat_model: "gpt-4o-mini",
    });
  });
});

describe("updateCustomAgent", () => {
  it("PATCHes the encoded id with the payload", async () => {
    const spy = vi.spyOn(apiClient, "patch").mockResolvedValue(mkRecord());
    await updateCustomAgent("my-agent", { name: "My Agent" });
    expect(spy).toHaveBeenCalledWith("/api/agents/registry/my-agent", {
      name: "My Agent",
    });
  });
});

describe("deleteCustomAgent", () => {
  it("DELETEs the encoded id", async () => {
    const spy = vi.spyOn(apiClient, "delete").mockResolvedValue(undefined);
    await deleteCustomAgent("my agent");
    expect(spy).toHaveBeenCalledWith("/api/agents/registry/my%20agent");
  });
});
