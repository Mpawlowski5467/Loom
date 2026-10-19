import { describe, expect, it } from "vitest";
import type { StandupAutomation } from "@/api/automations";
import type { AgentEvent, Capture, Note } from "@/data/types";
import { agentBoardState, computeBoardStats, stateContext } from "./boardStats";

const now = new Date(2026, 4, 16, 12, 0);
const ev = (
  agent: string,
  ts: Date,
  sentinel: AgentEvent["sentinel"] = "ok",
): AgentEvent => ({
  id: `${agent}-${ts.getTime()}`,
  ts: ts.toISOString(),
  agent,
  action: "did",
  target: "",
  chain: "ok",
  sentinel,
});
const today = new Date(2026, 4, 16, 9, 0);
const earlier = new Date(2026, 4, 13, 9, 0);

const automation = (
  over: Partial<StandupAutomation["status"]> = {},
  enabled = true,
) =>
  ({
    schedule: { enabled, run_time: "08:00", timezone: "UTC" },
    calendar: {},
    status: {
      running: false,
      paused: false,
      next_run_at: "2026-05-17T08:00:00Z",
      state: {},
      ...over,
    },
  }) as unknown as StandupAutomation;

describe("computeBoardStats", () => {
  it("counts today's actions, per-agent activity and Sentinel verdicts", () => {
    const feed = [
      ev("weaver", today),
      ev("sentinel", today, "ok"),
      ev("sentinel", earlier, "warn"),
      ev("sentinel", earlier, "fail"),
      ev("spider", earlier),
    ];
    const stats = computeBoardStats(feed, [], [], null, now);
    expect(stats.actionsToday).toBe(2);
    expect(stats.actionsWeek).toBe(5);
    expect(stats.actionsTodayCapped).toBe(false);
    expect(stats.sentinel).toEqual({
      reviewed: 3,
      passed: 1,
      warnings: 1,
      failed: 1,
    });
    expect(stats.perAgent.get("sentinel")).toBe(3);
  });

  it("counts open flags on notes and unfinished captures", () => {
    const notes = [
      { status: "active", reviewRequired: true },
      { status: "active", extra: { flagged: true } },
      { status: "archived", reviewRequired: true },
      { status: "active" },
    ] as Note[];
    const captures = [
      { status: "needs_review" },
      { status: "pending", flagged: true },
      { status: "done", flagged: true },
    ] as Capture[];
    expect(computeBoardStats([], notes, captures, null, now).flags).toEqual({
      notes: 2,
      captures: 2,
    });
  });

  it("reports the next scheduled run only while the schedule is on", () => {
    expect(computeBoardStats([], [], [], automation(), now).nextRun).toEqual({
      agent: "standup",
      at: "2026-05-17T08:00:00Z",
    });
    expect(
      computeBoardStats([], [], [], automation({ paused: true }), now).nextRun,
    ).toBeNull();
    expect(
      computeBoardStats([], [], [], automation({}, false), now).nextRun,
    ).toBeNull();
  });
});

describe("agentBoardState", () => {
  const ctx = stateContext(automation(), { mode: "trusted" } as never);
  it("derives running, scheduled and watching", () => {
    expect(agentBoardState("spider", { state: "running" } as never, ctx)).toBe(
      "running",
    );
    expect(agentBoardState("standup", undefined, ctx)).toBe("scheduled");
    expect(agentBoardState("sentinel", undefined, ctx)).toBe("watching");
    expect(agentBoardState("weaver", undefined, ctx)).toBe("watching");
    expect(agentBoardState("spider", undefined, ctx)).toBe("idle");
  });

  it("leaves Weaver idle when captures are processed by hand", () => {
    const manual = stateContext(null, { mode: "manual" } as never);
    expect(agentBoardState("weaver", undefined, manual)).toBe("idle");
    expect(agentBoardState("standup", undefined, manual)).toBe("idle");
  });
});
