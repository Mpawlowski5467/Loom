import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Agent } from "../../data/types";
import { AgentCard } from "./AgentCard";

const agent: Agent = {
  id: "researcher",
  name: "Researcher",
  layer: "shuttle",
  role: "Finds evidence",
  icon: "🔭",
  state: "idle",
  stats: { runs: 3, lastRun: "never" },
  lastAction: "Collected sources",
};

function setup(overrides: { running?: boolean; isCustom?: boolean } = {}) {
  const callbacks = {
    onRun: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onWorkspace: vi.fn(),
    onOpen: vi.fn(),
  };
  render(
    <AgentCard
      agent={agent}
      live={undefined}
      lastEvent={undefined}
      isCustom={overrides.isCustom ?? true}
      runnable
      running={overrides.running ?? false}
      {...callbacks}
    />,
  );
  return callbacks;
}

describe("AgentCard", () => {
  it("opens from the card keyboard target without double-firing actions", async () => {
    const user = userEvent.setup();
    const callbacks = setup();
    const card = screen.getByRole("button", { name: "Researcher details" });

    card.focus();
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "Run Researcher" }));

    expect(callbacks.onOpen).toHaveBeenCalledTimes(1);
    expect(callbacks.onRun).toHaveBeenCalledTimes(1);
  });

  it("disables run while active and exposes custom actions", () => {
    setup({ running: true });

    expect(
      screen.getByRole("button", { name: "Run Researcher" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Edit Researcher" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Delete Researcher" }),
    ).toBeVisible();
  });
});
