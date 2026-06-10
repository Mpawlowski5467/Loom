import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppCtx, type AppContextValue } from "../../context/app-ctx";
import { CardsMode } from "./CardsMode";
import type { Agent } from "../../data/types";

const { deleteCustomAgent, getAgentRegistry } = vi.hoisted(() => ({
  deleteCustomAgent: vi.fn(),
  getAgentRegistry: vi.fn(),
}));

vi.mock("../../api/agentsRegistry", () => ({
  deleteCustomAgent,
  getAgentRegistry,
}));

vi.mock("../../api/agents", () => ({
  RUNNABLE_LOOM_AGENTS: new Set<string>(),
  formatRunResult: () => "ran",
  runAgent: vi.fn(),
}));

function mkAgent(over: Partial<Agent> = {}): Agent {
  return {
    id: "agt_custom1",
    name: "Scout",
    layer: "shuttle",
    role: "Finds things",
    icon: "🔭",
    state: "idle",
    stats: { runs: 0, lastRun: "never" },
    lastAction: "—",
    ...over,
  };
}

function renderCards(custom: Agent[]) {
  const refreshCustomAgents = vi.fn().mockResolvedValue(undefined);
  const pushToast = vi.fn();
  const value = {
    agents: [],
    agentActivity: {},
    changelog: [],
    customAgents: custom,
    refreshCustomAgents,
    pushToast,
  } as unknown as AppContextValue;
  function Harness(): ReactNode {
    return (
      <AppCtx.Provider value={value}>
        <CardsMode />
      </AppCtx.Provider>
    );
  }
  render(<Harness />);
  return { refreshCustomAgents, pushToast };
}

beforeEach(() => {
  deleteCustomAgent.mockReset().mockResolvedValue(undefined);
  getAgentRegistry.mockReset();
});

describe("CardsMode delete confirmation", () => {
  it("opens an accessible ConfirmModal instead of window.confirm on delete", async () => {
    const user = userEvent.setup();
    renderCards([mkAgent()]);

    await user.click(screen.getByRole("button", { name: "Delete Scout" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(
      screen.getByText('Delete custom agent "Scout"?'),
    ).toBeInTheDocument();
    // Nothing deleted until the user confirms.
    expect(deleteCustomAgent).not.toHaveBeenCalled();
  });

  it("deletes the agent and refreshes after confirming", async () => {
    const user = userEvent.setup();
    const { refreshCustomAgents, pushToast } = renderCards([mkAgent()]);

    await user.click(screen.getByRole("button", { name: "Delete Scout" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(deleteCustomAgent).toHaveBeenCalledWith("agt_custom1"),
    );
    expect(refreshCustomAgents).toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ body: "Deleted agent Scout" }),
    );
  });

  it("does not delete when the confirm is cancelled", async () => {
    const user = userEvent.setup();
    renderCards([mkAgent()]);

    await user.click(screen.getByRole("button", { name: "Delete Scout" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(deleteCustomAgent).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
