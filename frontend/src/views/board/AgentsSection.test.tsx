import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppCtx, type AppContextValue } from "@/context/app-ctx";
import type { Agent } from "@/data/types";
import { AgentsSection } from "./AgentsSection";
import { computeBoardStats } from "./boardStats";

const { deleteCustomAgent, getAgentRegistry, runAgent } = vi.hoisted(() => ({
  deleteCustomAgent: vi.fn(),
  getAgentRegistry: vi.fn(),
  runAgent: vi.fn(),
}));
vi.mock("@/api/agentsRegistry", () => ({
  deleteCustomAgent,
  getAgentRegistry,
}));
vi.mock("@/api/agents", () => ({
  RUNNABLE_LOOM_AGENTS: new Set(["spider"]),
  formatRunResult: () => "ran",
  runAgent,
}));
// Dialogs are their own units; stub them and assert what opens.
vi.mock("./AgentDetailModal", () => ({
  AgentDetailModal: ({
    agent,
    onDelete,
    onEdit,
  }: {
    agent: Agent;
    onDelete: () => void;
    onEdit: () => void;
  }) => (
    <div role="dialog" aria-label={`${agent.name} details`}>
      <button type="button" onClick={onEdit}>
        Edit
      </button>
      <button type="button" onClick={onDelete}>
        Delete
      </button>
    </div>
  ),
}));
vi.mock("./AddAgentModal", () => ({
  AddAgentModal: ({ existing }: { existing?: { name: string } }) => (
    <div
      role="dialog"
      aria-label={existing ? `Edit ${existing.name}` : "Add agent"}
    />
  ),
}));
vi.mock("./ResearcherWorkspace", () => ({
  ResearcherWorkspace: () => (
    <div role="dialog" aria-label="Researcher workspace" />
  ),
}));
vi.mock("./StandupWorkspace", () => ({
  StandupWorkspace: () => <div role="dialog" aria-label="Standup workspace" />,
}));

const agent = (
  id: string,
  layer: "loom" | "shuttle",
  over: Partial<Agent> = {},
): Agent => ({
  id,
  name: id,
  layer,
  role: `${id} role`,
  icon: "",
  state: "idle",
  stats: { runs: 0, lastRun: "never" },
  lastAction: "",
  ...over,
});
const builtIn = [
  agent("weaver", "loom"),
  agent("spider", "loom"),
  agent("researcher", "shuttle"),
  agent("standup", "shuttle"),
];
const custom = agent("my-agent", "shuttle", { name: "My Agent" });

function renderSection(url = "/board") {
  const ctx = {
    agents: builtIn,
    customAgents: [custom],
    agentActivity: {},
    changelog: [],
    refreshCustomAgents: vi.fn(async () => {}),
    pushToast: vi.fn(),
  } as unknown as AppContextValue;
  render(
    <MemoryRouter initialEntries={[url]}>
      <AppCtx.Provider value={ctx}>
        <AgentsSection
          stats={computeBoardStats([], [], [], null)}
          stateCtx={{ standupScheduled: true, autoProcessing: false }}
        />
      </AppCtx.Provider>
    </MemoryRouter>,
  );
  return ctx;
}

beforeEach(() => {
  vi.clearAllMocks();
  runAgent.mockResolvedValue({ agent: "x", result: {} });
  deleteCustomAgent.mockResolvedValue(undefined);
});

describe("AgentsSection", () => {
  it("shows Loom agents as cards and Shuttle agents in one dashed card", () => {
    renderSection();
    expect(screen.getByRole("article", { name: "Weaver" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Spider" })).toBeInTheDocument();
    const shuttle = screen.getByRole("region", { name: "Shuttle agents" });
    expect(within(shuttle).getByText("Researcher")).toBeInTheDocument();
    expect(within(shuttle).getByText("Scheduled")).toBeInTheDocument();
    expect(within(shuttle).getByText("My Agent")).toBeInTheDocument();
  });

  it("runs a runnable agent and blocks pipeline-only ones", async () => {
    const user = userEvent.setup();
    renderSection();
    expect(
      screen.getByRole("button", { name: "Run Weaver now" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Run Spider now" }));
    expect(runAgent).toHaveBeenCalledWith("spider");
  });

  it("runs a custom agent by its registry id", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole("button", { name: "Run My Agent" }));
    expect(runAgent).toHaveBeenCalledWith("my-agent");
  });

  it("opens logs, workspaces and the builder", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole("button", { name: "Spider logs" }));
    expect(
      screen.getByRole("dialog", { name: "spider details" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ask Researcher" }));
    expect(
      screen.getByRole("dialog", { name: "Researcher workspace" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open Standup" }));
    expect(
      screen.getByRole("dialog", { name: "Standup workspace" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add agent" }));
    expect(
      screen.getByRole("dialog", { name: "Add agent" }),
    ).toBeInTheDocument();
  });

  it("edits a custom agent from its details", async () => {
    getAgentRegistry.mockResolvedValue({ id: "my-agent", name: "My Agent" });
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole("button", { name: "My Agent logs" }));
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(
      await screen.findByRole("dialog", { name: "Edit My Agent" }),
    ).toBeInTheDocument();
  });

  it("deletes a custom agent only after confirming", async () => {
    const user = userEvent.setup();
    const ctx = renderSection();
    await user.click(screen.getByRole("button", { name: "My Agent logs" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(
      screen.getByText('Delete custom agent "My Agent"?'),
    ).toBeInTheDocument();
    expect(deleteCustomAgent).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(deleteCustomAgent).toHaveBeenCalledWith("my-agent"),
    );
    expect(ctx.refreshCustomAgents).toHaveBeenCalled();
  });

  it("opens the agent named in ?agent= (from the palette)", () => {
    renderSection("/board?agent=spider");
    expect(
      screen.getByRole("dialog", { name: "spider details" }),
    ).toBeInTheDocument();
  });
});
