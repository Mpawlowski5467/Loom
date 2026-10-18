import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../../data/types";
import { RecentActivity } from "./RecentActivity";

const history = vi.hoisted(() => ({ revertCommit: vi.fn() }));
vi.mock("../../api/history", () => history);

function event(index: number): AgentEvent {
  return {
    id: `event-${index}`,
    ts: `2026-08-16T00:${String(index).padStart(2, "0")}:00Z`,
    agent: "weaver",
    action: "filed",
    target: `[[Note ${index}]]`,
    chain: "ok",
    sentinel: index % 2 === 0 ? "ok" : "warn",
  };
}

describe("RecentActivity", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-16T01:00:00Z");
  });
  afterEach(() => vi.useRealTimers());

  it("shows a useful empty state", () => {
    render(<RecentActivity changelog={[]} />);
    expect(screen.getByText(/No agent activity yet/)).toBeVisible();
  });

  it("bounds the feed and renders linked targets and verdicts", () => {
    const { container } = render(
      <RecentActivity
        changelog={Array.from({ length: 20 }, (_, index) => event(index))}
      />,
    );

    expect(container.querySelectorAll(".changelog-row")).toHaveLength(15);
    expect(container.querySelectorAll(".board-wikilink")).toHaveLength(15);
    expect(screen.getAllByText("✓").length).toBeGreaterThan(0);
    expect(screen.getAllByText("⚠").length).toBeGreaterThan(0);
  });
});

describe("RecentActivity undo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("offers undo only for actions that produced a history commit", () => {
    render(
      <RecentActivity
        changelog={[{ ...event(1), commit: "c".repeat(40) }, event(2)]}
      />,
    );
    expect(screen.getAllByRole("button", { name: /^Undo / })).toHaveLength(1);
  });

  it("reverts the action's commit after confirmation", async () => {
    history.revertCommit.mockResolvedValue({ sha: "d".repeat(40) });
    const user = userEvent.setup();
    render(
      <RecentActivity changelog={[{ ...event(1), commit: "c".repeat(40) }]} />,
    );
    await user.click(screen.getByRole("button", { name: /^Undo weaver/ }));
    expect(screen.getByRole("dialog")).toHaveTextContent("cccccccccc");
    await user.click(screen.getByRole("button", { name: "Undo action" }));
    expect(await screen.findByText("undone")).toBeVisible();
    expect(history.revertCommit).toHaveBeenCalledWith("c".repeat(40));
  });

  it("shows why an undo was refused and keeps the action undoable", async () => {
    history.revertCommit.mockRejectedValue(
      new Error("Sentinel blocked this revert (failed)."),
    );
    const user = userEvent.setup();
    render(
      <RecentActivity changelog={[{ ...event(1), commit: "c".repeat(40) }]} />,
    );
    await user.click(screen.getByRole("button", { name: /^Undo weaver/ }));
    await user.click(screen.getByRole("button", { name: "Undo action" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Sentinel blocked",
    );
    expect(screen.queryByText("undone")).toBeNull();
  });
});
