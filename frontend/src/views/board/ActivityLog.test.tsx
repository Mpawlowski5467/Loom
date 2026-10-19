import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "@/data/types";
import { ActivityLog } from "./ActivityLog";

const history = vi.hoisted(() => ({ revertCommit: vi.fn() }));
vi.mock("@/api/history", () => history);

function event(index: number, over: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: `event-${index}`,
    ts: `2026-08-16T00:${String(index).padStart(2, "0")}:00Z`,
    agent: "weaver",
    action: "filed",
    target: `[[Note ${index}]]`,
    chain: "ok",
    sentinel: (["ok", "warn", "fail"] as const)[index % 3]!,
    ...over,
  };
}

const rows = () => screen.getAllByRole("row").slice(1);

describe("ActivityLog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows a useful empty state", () => {
    render(<ActivityLog events={[]} />);
    expect(screen.getByText(/No agent activity yet/)).toBeVisible();
  });

  it("notes that rows are commits, pages the table and labels verdicts", async () => {
    const user = userEvent.setup();
    render(
      <ActivityLog events={Array.from({ length: 20 }, (_, i) => event(i))} />,
    );
    expect(
      screen.getByText("Each row is a git commit in your vault."),
    ).toBeVisible();
    expect(rows()).toHaveLength(15);
    expect(within(rows()[0]!).getByText("passed")).toBeVisible();
    expect(within(rows()[1]!).getByText("warning")).toBeVisible();
    expect(within(rows()[2]!).getByText("needs review")).toBeVisible();
    expect(within(rows()[0]!).getByText("Note 0")).toHaveAttribute(
      "data-wikilink",
    );
    await user.click(screen.getByRole("button", { name: "Show more" }));
    expect(rows()).toHaveLength(20);
  });

  it("offers undo only for actions with a commit, and marks undone ones", () => {
    render(
      <ActivityLog
        events={[
          event(1, { commit: "c".repeat(40) }),
          event(2),
          event(3, { commit: "d".repeat(40), reverted: true }),
        ]}
      />,
    );
    expect(screen.getAllByRole("button", { name: /^Undo / })).toHaveLength(1);
    expect(screen.getByText("Undone")).toBeVisible();
  });

  it("reverts the action's commit after confirmation", async () => {
    history.revertCommit.mockResolvedValue({ sha: "e".repeat(40) });
    const user = userEvent.setup();
    render(<ActivityLog events={[event(1, { commit: "c".repeat(40) })]} />);
    await user.click(screen.getByRole("button", { name: /^Undo weaver/ }));
    expect(screen.getByRole("dialog")).toHaveTextContent("cccccccccc");
    await user.click(screen.getByRole("button", { name: "Undo action" }));
    expect(await screen.findByText("Undone")).toBeVisible();
    expect(history.revertCommit).toHaveBeenCalledWith("c".repeat(40));
  });

  it("shows why an undo was refused and keeps the action undoable", async () => {
    history.revertCommit.mockRejectedValue(
      new Error("Sentinel blocked this revert (failed)."),
    );
    const user = userEvent.setup();
    render(<ActivityLog events={[event(1, { commit: "c".repeat(40) })]} />);
    await user.click(screen.getByRole("button", { name: /^Undo weaver/ }));
    await user.click(screen.getByRole("button", { name: "Undo action" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Sentinel blocked",
    );
    expect(screen.queryByText("Undone")).toBeNull();
  });
});
