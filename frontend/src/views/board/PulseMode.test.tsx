import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { AppCtx, type AppContextValue } from "../../context/app-ctx";
import { PulseMode } from "./PulseMode";
import type { AgentActivity } from "../../api/activity";
import type { Agent } from "../../data/types";

function mkAgent(over: Partial<Agent> = {}): Agent {
  return {
    id: "agt_scout",
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

function mkActivity(over: Partial<AgentActivity> = {}): AgentActivity {
  return {
    name: "scout",
    state: "idle",
    inflight: 0,
    action_count: 0,
    last_started_age_s: null,
    last_finished_age_s: null,
    pulse: [],
    ...over,
  };
}

function renderPulse(
  agents: Agent[],
  agentActivity: Record<string, AgentActivity> = {},
) {
  const value = {
    agents,
    agentActivity,
  } as unknown as AppContextValue;
  function Harness(): ReactNode {
    return (
      <AppCtx.Provider value={value}>
        <PulseMode
          stateCtx={{ standupScheduled: false, autoProcessing: false }}
        />
      </AppCtx.Provider>
    );
  }
  render(<Harness />);
}

describe("PulseMode", () => {
  it("renders the empty state when there are no agents", () => {
    renderPulse([]);

    expect(screen.getByText(/No agents to chart\./i)).toBeInTheDocument();
  });

  it("renders a pulse row per agent with name, status label, and run count", () => {
    renderPulse([
      mkAgent({
        id: "agt_scout",
        name: "Scout",
        stats: { runs: 3, lastRun: "never" },
      }),
      mkAgent({
        id: "agt_weaver",
        name: "Weaver",
        stats: { runs: 9, lastRun: "never" },
      }),
    ]);

    expect(screen.getByText("Scout")).toBeInTheDocument();
    expect(screen.getByText("Weaver")).toBeInTheDocument();

    // runs falls back to a.stats.runs when there is no live action_count.
    expect(screen.getByText("3 runs")).toBeInTheDocument();
    expect(screen.getByText("9 runs")).toBeInTheDocument();

    expect(screen.getAllByText("Idle")).toHaveLength(2);
  });

  it("prefers the live action_count over static stats for the run count", () => {
    renderPulse(
      [mkAgent({ name: "Scout", stats: { runs: 3, lastRun: "never" } })],
      { agt_scout: mkActivity({ action_count: 42 }) },
    );

    expect(screen.getByText("42 runs")).toBeInTheDocument();
    expect(screen.queryByText("3 runs")).not.toBeInTheDocument();
  });

  it("shows the running label for an agent whose live state is running", () => {
    renderPulse([mkAgent({ name: "Scout" })], {
      agt_scout: mkActivity({ state: "running" }),
    });

    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.queryByText("Idle")).not.toBeInTheDocument();
  });

  it("shows the idle label for an agent whose live state is idle", () => {
    renderPulse([mkAgent({ name: "Scout" })], {
      agt_scout: mkActivity({ state: "idle" }),
    });

    expect(screen.getByText("Idle")).toBeInTheDocument();
    expect(screen.queryByText("Running")).not.toBeInTheDocument();
  });
});
