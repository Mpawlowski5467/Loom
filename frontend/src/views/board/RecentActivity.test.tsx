import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../../data/types";
import { RecentActivity } from "./RecentActivity";

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
