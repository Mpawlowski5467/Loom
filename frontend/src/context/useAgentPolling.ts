import { useState, useEffect } from "react";
import { fetchAgentActivity, type AgentActivity } from "../api/activity";
import { fetchChangelogFeed } from "../api/changelog";
import type { AgentEvent } from "../data/types";

/** Board cadence: live cards and pulse lines. */
export const BOARD_ACTIVITY_MS = 1000;
/** Header cadence: just enough for the "Weaver running…" status. */
export const HEADER_ACTIVITY_MS = 5000;
const CHANGELOG_INTERVAL_MS = 3000;

export interface AgentPollingOptions {
  /** Activity poll interval, or null to stop polling activity. */
  activityMs: number | null;
  /** Poll the changelog feed (only the Board needs it). */
  changelog: boolean;
}

export interface AgentPolling {
  changelog: AgentEvent[];
  agentActivity: Record<string, AgentActivity>;
}

/**
 * Poll agent activity and the changelog feed. The caller picks the cadence:
 * the Board polls activity every second plus the changelog every 3s; other
 * views poll activity slowly for the header's agent status. Pass
 * `activityMs: null, changelog: false` (offline, demo) to stop everything.
 * Fetches are skipped while the browser tab is hidden, so a backgrounded
 * window does no network work. ``demoChangelog`` seeds the feed in demo mode.
 */
export function useAgentPolling(
  { activityMs, changelog: pollFeed }: AgentPollingOptions,
  demoChangelog: AgentEvent[],
): AgentPolling {
  const [changelog, setChangelog] = useState<AgentEvent[]>(demoChangelog);
  const [agentActivity, setAgentActivity] = useState<
    Record<string, AgentActivity>
  >({});

  useEffect(() => {
    if (activityMs === null && !pollFeed) return;
    let cancelled = false;
    let activityTimer: number | null = null;
    let changelogTimer: number | null = null;

    const pollActivity = async () => {
      if (!document.hidden) {
        try {
          const items = await fetchAgentActivity();
          if (cancelled) return;
          const next: Record<string, AgentActivity> = {};
          for (const a of items) next[a.name] = a;
          setAgentActivity(next);
        } catch {
          // best-effort; backend may be cold during dev restarts
        }
      }
      if (!cancelled) {
        activityTimer = window.setTimeout(pollActivity, activityMs ?? 0);
      }
    };

    const pollChangelog = async () => {
      if (!document.hidden) {
        try {
          const items = await fetchChangelogFeed(40);
          if (cancelled) return;
          setChangelog(
            items.map((e) => ({
              id: e.id,
              ts: e.ts,
              agent: e.agent,
              action: e.action,
              target: e.target,
              chain: e.chain === "ok" ? "ok" : "fail",
              sentinel: e.sentinel as AgentEvent["sentinel"],
              commit: e.commit ?? null,
              reverted: e.reverted ?? false,
            })),
          );
        } catch {
          // best-effort
        }
      }
      if (!cancelled) {
        changelogTimer = window.setTimeout(
          pollChangelog,
          CHANGELOG_INTERVAL_MS,
        );
      }
    };

    if (activityMs !== null) void pollActivity();
    if (pollFeed) void pollChangelog();

    return () => {
      cancelled = true;
      if (activityTimer !== null) window.clearTimeout(activityTimer);
      if (changelogTimer !== null) window.clearTimeout(changelogTimer);
    };
  }, [activityMs, pollFeed]);

  return { changelog, agentActivity };
}
