import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Agent } from "@/data/types";
import { AgentCard } from "./AgentCard";

const spider: Agent = {
  id: "spider",
  name: "spider",
  layer: "loom",
  role: "auto-links across the vault",
  icon: "",
  state: "idle",
  stats: { runs: 0, lastRun: "never" },
  lastAction: "",
};

function renderCard(over: Partial<Parameters<typeof AgentCard>[0]> = {}) {
  const props = {
    agent: spider,
    state: "idle" as const,
    lastEvent: undefined,
    weekActions: 4,
    running: false,
    onRun: vi.fn(),
    onLogs: vi.fn(),
    ...over,
  };
  render(<AgentCard {...props} />);
  return props;
}

describe("AgentCard", () => {
  it("shows the agent, its state, last action and weekly count", () => {
    renderCard({
      state: "running",
      lastEvent: {
        id: "e1",
        ts: "2026-05-16T09:00:00Z",
        agent: "spider",
        action: "linked",
        target: "[[Webhooks]]",
        chain: "ok",
        sentinel: "ok",
      },
    });
    const card = screen.getByRole("article", { name: "Spider" });
    expect(card).toHaveTextContent("auto-links across the vault");
    expect(card).toHaveTextContent("Running");
    expect(card).toHaveTextContent(/linked Webhooks/);
    expect(card).toHaveTextContent("4 actions this week");
  });

  it("opens logs and runs the agent", async () => {
    const user = userEvent.setup();
    const p = renderCard();
    expect(screen.getByText("No actions yet.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Spider logs" }));
    expect(p.onLogs).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Run Spider now" }));
    expect(p.onRun).toHaveBeenCalled();
  });

  it("disables Run now for pipeline-only agents and says why", () => {
    renderCard({ runBlocked: "Runs as a step of the capture pipeline." });
    const run = screen.getByRole("button", { name: "Run Spider now" });
    expect(run).toBeDisabled();
    expect(run.parentElement).toHaveAttribute(
      "title",
      "Runs as a step of the capture pipeline.",
    );
  });
});
