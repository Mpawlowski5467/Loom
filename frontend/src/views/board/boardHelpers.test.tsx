import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  formatRelativeTime,
  formatAge,
  renderTarget,
  liveAgentState,
  boardStatus,
} from "./boardHelpers";
import type { Agent, AgentState } from "../../data/types";
import type { AgentActivity } from "../../api/activity";

const NOW = Date.parse("2026-05-30T12:00:00Z");

function mkAgent(state: AgentState): Agent {
  return {
    id: "weaver",
    name: "Weaver",
    layer: "loom",
    role: "Creator",
    icon: "🧶",
    state,
    stats: { runs: 0, lastRun: "" },
    lastAction: "",
  } as Agent;
}

function mkActivity(overrides: Partial<AgentActivity> = {}): AgentActivity {
  return {
    name: "weaver",
    state: "idle",
    inflight: 0,
    action_count: 0,
    last_started_age_s: null,
    last_finished_age_s: null,
    pulse: [],
    ...overrides,
  };
}

describe("formatRelativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns seconds for very recent times", () => {
    expect(formatRelativeTime("2026-05-30T11:59:30Z")).toBe("30s ago");
  });

  it("returns minutes under an hour", () => {
    expect(formatRelativeTime("2026-05-30T11:45:00Z")).toBe("15m ago");
  });

  it("returns hours under a day", () => {
    expect(formatRelativeTime("2026-05-30T09:00:00Z")).toBe("3h ago");
  });

  it("returns days beyond 24 hours", () => {
    expect(formatRelativeTime("2026-05-28T12:00:00Z")).toBe("2d ago");
  });

  it("clamps future timestamps to 0s", () => {
    expect(formatRelativeTime("2026-05-30T12:00:30Z")).toBe("0s ago");
  });

  it("returns the raw string when it is not a parseable date", () => {
    expect(formatRelativeTime("never")).toBe("never");
  });
});

describe("formatAge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("converts an age in seconds into a relative label", () => {
    expect(formatAge(90)).toBe("1m ago");
    expect(formatAge(10)).toBe("10s ago");
  });
});

describe("renderTarget", () => {
  it("renders a bare path as a styled wikilink, dropping the .md", () => {
    const { container } = render(<>{renderTarget("caching.md")}</>);
    const link = container.querySelector(".board-wikilink");
    expect(link?.textContent).toBe("caching");
  });

  it("styles an explicit wikilink and keeps surrounding text", () => {
    const { container } = render(<>{renderTarget("linked [[Embeddings]] note")}</>);
    expect(container.querySelector(".board-wikilink")?.textContent).toBe(
      "Embeddings",
    );
    expect(container.textContent).toContain("linked");
    expect(container.textContent).toContain("note");
  });

  it("shows only the display side of an aliased wikilink", () => {
    const { container } = render(<>{renderTarget("[[note-id|Display Name]]")}</>);
    expect(container.querySelector(".board-wikilink")?.textContent).toBe(
      "note-id",
    );
  });

  it("renders nothing styled for an empty target", () => {
    const { container } = render(<>{renderTarget("")}</>);
    expect(container.querySelector(".board-wikilink")).toBeNull();
  });
});

describe("liveAgentState", () => {
  it("prefers a live running activity over the static state", () => {
    expect(liveAgentState(mkAgent("idle"), mkActivity({ state: "running" }))).toBe(
      "running",
    );
  });

  it("falls back to the agent's own state otherwise", () => {
    expect(liveAgentState(mkAgent("idle"), mkActivity({ state: "idle" }))).toBe(
      "idle",
    );
    expect(liveAgentState(mkAgent("running"), undefined)).toBe("running");
  });
});

describe("boardStatus", () => {
  it("reports running when the agent is live", () => {
    expect(boardStatus(mkAgent("idle"), mkActivity({ state: "running" }))).toEqual(
      { state: "running", label: "running" },
    );
  });

  it("labels a recently-active idle agent as settling (idle dot)", () => {
    const status = boardStatus(
      mkAgent("idle"),
      mkActivity({ pulse: [0, 0.1, 0] }),
    );
    expect(status).toEqual({ state: "idle", label: "settling" });
  });

  it("reports plain idle when there is no recent pulse", () => {
    const status = boardStatus(
      mkAgent("idle"),
      mkActivity({ pulse: [0, 0.01, 0] }),
    );
    expect(status).toEqual({ state: "idle", label: "idle" });
  });

  it("reports idle with no activity at all", () => {
    expect(boardStatus(mkAgent("idle"), undefined)).toEqual({
      state: "idle",
      label: "idle",
    });
  });
});
