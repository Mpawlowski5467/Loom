import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppCtx, type AppContextValue } from "../../context/app-ctx";
import { CardsMode } from "./CardsMode";
import type { Agent } from "../../data/types";

const { deleteCustomAgent, getAgentRegistry, runAgent } = vi.hoisted(() => ({
  deleteCustomAgent: vi.fn(),
  getAgentRegistry: vi.fn(),
  runAgent: vi.fn(),
}));

vi.mock("../../api/agentsRegistry", () => ({
  deleteCustomAgent,
  getAgentRegistry,
}));

vi.mock("../../api/agents", () => ({
  RUNNABLE_LOOM_AGENTS: new Set<string>(["scribe"]),
  formatRunResult: () => "ran",
  runAgent,
}));

// The detail modal is its own unit (fetches + polls); stub it and assert
// CardsMode opens it with the right agent.
vi.mock("./AgentDetailModal", () => ({
  AgentDetailModal: ({ agent }: { agent: Agent }) => (
    <div data-testid="agent-detail">{agent.name}</div>
  ),
}));
vi.mock("./ResearcherWorkspace", () => ({
  ResearcherWorkspace: () => (
    <div data-testid="researcher-workspace">Researcher workspace</div>
  ),
}));
vi.mock("./StandupWorkspace", () => ({
  StandupWorkspace: () => (
    <div data-testid="standup-workspace">Standup workspace</div>
  ),
}));

function mkAgent(over: Partial<Agent> = {}): Agent {
  return {
    id: "my-agent",
    name: "My Agent",
    layer: "shuttle",
    role: "Finds things",
    icon: "🔭",
    state: "idle",
    stats: { runs: 0, lastRun: "never" },
    lastAction: "—",
    ...over,
  };
}

function renderCards(custom: Agent[], builtIn: Agent[] = []) {
  const refreshCustomAgents = vi.fn().mockResolvedValue(undefined);
  const pushToast = vi.fn();
  const value = {
    agents: builtIn,
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
  runAgent.mockReset().mockResolvedValue({ agent: "my-agent", result: {} });
});

describe("CardsMode delete confirmation", () => {
  it("opens an accessible ConfirmModal instead of window.confirm on delete", async () => {
    const user = userEvent.setup();
    renderCards([mkAgent()]);

    await user.click(screen.getByRole("button", { name: "Delete My Agent" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(
      screen.getByText('Delete custom agent "My Agent"?'),
    ).toBeInTheDocument();
    // Nothing deleted until the user confirms; the card click didn't bubble
    // into opening the detail modal either.
    expect(deleteCustomAgent).not.toHaveBeenCalled();
    expect(screen.queryByTestId("agent-detail")).not.toBeInTheDocument();
  });

  it("deletes the agent and refreshes after confirming", async () => {
    const user = userEvent.setup();
    const { refreshCustomAgents, pushToast } = renderCards([mkAgent()]);

    await user.click(screen.getByRole("button", { name: "Delete My Agent" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(deleteCustomAgent).toHaveBeenCalledWith("my-agent"),
    );
    expect(refreshCustomAgents).toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ body: "Deleted agent My Agent" }),
    );
  });

  it("does not delete when the confirm is cancelled", async () => {
    const user = userEvent.setup();
    renderCards([mkAgent()]);

    await user.click(screen.getByRole("button", { name: "Delete My Agent" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(deleteCustomAgent).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("CardsMode agent detail", () => {
  it("opens the detail modal when the card body is clicked", async () => {
    const user = userEvent.setup();
    renderCards([mkAgent()]);

    await user.click(screen.getByRole("button", { name: "My Agent details" }));

    expect(screen.getByTestId("agent-detail")).toHaveTextContent("My Agent");
  });

  it("opens the detail modal with the keyboard", async () => {
    const user = userEvent.setup();
    renderCards([mkAgent()]);

    screen.getByRole("button", { name: "My Agent details" }).focus();
    await user.keyboard("{Enter}");

    expect(screen.getByTestId("agent-detail")).toBeInTheDocument();
  });

  it("opens the one-to-one workspace from the built-in Researcher card", async () => {
    const user = userEvent.setup();
    renderCards([], [mkAgent({ id: "researcher", name: "researcher" })]);

    await user.click(
      screen.getByRole("button", { name: "Open researcher workspace" }),
    );

    expect(screen.getByTestId("researcher-workspace")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-detail")).not.toBeInTheDocument();
  });

  it("keeps the Researcher detail inspector available from the card body", async () => {
    const user = userEvent.setup();
    renderCards([], [mkAgent({ id: "researcher", name: "researcher" })]);

    await user.click(
      screen.getByRole("button", { name: "researcher details" }),
    );

    expect(screen.getByTestId("agent-detail")).toHaveTextContent("researcher");
    expect(
      screen.queryByTestId("researcher-workspace"),
    ).not.toBeInTheDocument();
  });

  it("opens the dedicated Standup workspace", async () => {
    const user = userEvent.setup();
    renderCards([], [mkAgent({ id: "standup", name: "standup" })]);

    await user.click(
      screen.getByRole("button", { name: "Open standup workspace" }),
    );

    expect(screen.getByTestId("standup-workspace")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-detail")).not.toBeInTheDocument();
  });
});

describe("CardsMode running agents", () => {
  it("runs a custom agent by its registry id, not its display name", async () => {
    const user = userEvent.setup();
    renderCards([mkAgent()]);

    await user.click(screen.getByRole("button", { name: "Run My Agent" }));

    // 'My Agent'.toLowerCase() would be "my agent" — the backend only knows
    // the slug id "my-agent".
    await waitFor(() => expect(runAgent).toHaveBeenCalledWith("my-agent"));
    // Running from the action button doesn't open the detail modal.
    expect(screen.queryByTestId("agent-detail")).not.toBeInTheDocument();
  });

  it("runs a runnable built-in by id and shows no run button for others", async () => {
    const user = userEvent.setup();
    renderCards(
      [],
      [
        mkAgent({ id: "scribe", name: "scribe", layer: "loom" }),
        mkAgent({ id: "weaver", name: "weaver", layer: "loom" }),
      ],
    );

    expect(
      screen.queryByRole("button", { name: "Run weaver" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Run scribe" }));
    await waitFor(() => expect(runAgent).toHaveBeenCalledWith("scribe"));
  });
});
