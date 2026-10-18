import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCustomAgents } from "./useCustomAgents";

const { listAgentRegistry } = vi.hoisted(() => ({
  listAgentRegistry: vi.fn(),
}));

vi.mock("../api/agentsRegistry", () => ({ listAgentRegistry }));

const registry = [
  {
    id: "weaver",
    name: "Weaver",
    layer: "loom",
    role: "system",
    icon: "W",
    system_prompt: "",
    system: true,
    provider: "",
    chat_model: "",
  },
  {
    id: "briefing",
    name: "Briefing",
    layer: "shuttle",
    role: "Summarizes",
    icon: "B",
    system_prompt: "",
    system: false,
    provider: "",
    chat_model: "",
  },
] as const;

beforeEach(() => {
  listAgentRegistry.mockReset().mockResolvedValue(registry);
});

describe("useCustomAgents", () => {
  it("loads only user-created registry entries when enabled", async () => {
    const { result } = renderHook(() => useCustomAgents(true));

    await waitFor(() => expect(result.current.customAgents).toHaveLength(1));
    expect(result.current.customAgents[0]).toMatchObject({
      id: "briefing",
      state: "idle",
    });
  });

  it("stays idle while disabled and supports an explicit refresh", async () => {
    const { result } = renderHook(() => useCustomAgents(false));
    expect(listAgentRegistry).not.toHaveBeenCalled();

    await act(async () => result.current.refreshCustomAgents());
    expect(result.current.customAgents).toHaveLength(1);
  });
});
