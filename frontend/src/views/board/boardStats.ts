import type { StandupAutomation } from "@/api/automations";
import type { CaptureProcessingPolicy } from "@/api/captures";
import type { AgentActivity } from "@/api/activity";
import type { AgentEvent, Capture, Note } from "@/data/types";

/** The changelog feed's deepest window (rows); see gap 9. */
export const FEED_WINDOW = 200;

export interface SentinelTally {
  reviewed: number;
  passed: number;
  warnings: number;
  failed: number;
}

export interface BoardStats {
  actionsToday: number;
  /** The feed window was full, so the real count may be higher. */
  actionsTodayCapped: boolean;
  actionsWeek: number;
  sentinel: SentinelTally;
  flags: { notes: number; captures: number };
  /** The next scheduled agent run, if any. */
  nextRun: { agent: string; at: string } | null;
  /** Actions per agent over the feed window (about a week). */
  perAgent: ReadonlyMap<string, number>;
}

function localDay(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Board stats from the changelog feed, loaded notes/captures and schedules. */
export function computeBoardStats(
  feed: readonly AgentEvent[],
  notes: readonly Note[],
  captures: readonly Capture[],
  automation: StandupAutomation | null,
  now = new Date(),
): BoardStats {
  const today = localDay(now);
  const perAgent = new Map<string, number>();
  const sentinel: SentinelTally = {
    reviewed: 0,
    passed: 0,
    warnings: 0,
    failed: 0,
  };
  let actionsToday = 0;
  for (const ev of feed) {
    perAgent.set(ev.agent, (perAgent.get(ev.agent) ?? 0) + 1);
    const at = new Date(ev.ts);
    if (!Number.isNaN(at.getTime()) && localDay(at) === today) actionsToday++;
    if (ev.agent !== "sentinel") continue;
    sentinel.reviewed++;
    if (ev.sentinel === "ok") sentinel.passed++;
    else if (ev.sentinel === "warn") sentinel.warnings++;
    else sentinel.failed++;
  }
  const flaggedNote = (n: Note) =>
    n.status !== "archived" &&
    (n.reviewRequired === true || n.extra?.flagged === true);
  const flaggedCapture = (c: Capture) =>
    c.status !== "done" &&
    (c.flagged === true ||
      c.reviewRequired === true ||
      c.status === "needs_review");
  const schedule = automation?.schedule;
  const nextAt = automation?.status.next_run_at;
  return {
    actionsToday,
    actionsTodayCapped:
      feed.length >= FEED_WINDOW && actionsToday === feed.length,
    actionsWeek: feed.length,
    sentinel,
    flags: {
      notes: notes.filter(flaggedNote).length,
      captures: captures.filter(flaggedCapture).length,
    },
    nextRun:
      schedule?.enabled && !automation?.status.paused && nextAt
        ? { agent: "standup", at: nextAt }
        : null,
    perAgent,
  };
}

export type AgentBoardState = "running" | "idle" | "scheduled" | "watching";

export interface AgentStateContext {
  standupScheduled: boolean;
  /** Captures are processed as they arrive (policy mode isn't "manual"). */
  autoProcessing: boolean;
}

/**
 * Running comes from live activity. The backend has no "scheduled" or
 * "watching" states yet (gap 9), so they're derived: Standup is scheduled
 * while its daily schedule is on; Sentinel gates every write, and Weaver
 * watches the Inbox while captures are processed automatically.
 */
export function agentBoardState(
  agentId: string,
  live: AgentActivity | undefined,
  ctx: AgentStateContext,
): AgentBoardState {
  if (live?.state === "running") return "running";
  if (agentId === "standup" && ctx.standupScheduled) return "scheduled";
  if (agentId === "sentinel") return "watching";
  if (agentId === "weaver" && ctx.autoProcessing) return "watching";
  return "idle";
}

export function stateContext(
  automation: StandupAutomation | null,
  policy: CaptureProcessingPolicy | null,
): AgentStateContext {
  return {
    standupScheduled: Boolean(
      automation?.schedule.enabled && !automation.status.paused,
    ),
    autoProcessing: policy !== null && policy.mode !== "manual",
  };
}
