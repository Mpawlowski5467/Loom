import { useState, useEffect } from "react";
import { fetchAgentActivity, type AgentActivity } from "../api/activity";
import { fetchChangelogFeed } from "../api/changelog";
import type { AgentEvent } from "../data/types";

const ACTIVITY_INTERVAL_MS = 1000;
const CHANGELOG_INTERVAL_MS = 3000;

export interface AgentPolling {
  changelog: AgentEvent[];
  agentActivity: Record<string, AgentActivity>;
}

/**
 * Poll agent activity (1s) and the changelog feed (3s) — but only while
 * ``enabled``. The caller passes ``true`` only when the Board (the sole
 * consumer of this data) is the active tab, the app is online, and it's not
 * demo mode; toggling it off tears the timers down. Fetches are also skipped
 * while the browser tab is hidden, so a backgrounded window does no network
 * work. ``demoChangelog`` seeds the feed in demo mode (no backend to poll).
 */
export function useAgentPolling(
  enabled: boolean,
  demoChangelog: AgentEvent[],
): AgentPolling {
  const [changelog, setChangelog] = useState<AgentEvent[]>(demoChangelog);
  const [agentActivity, setAgentActivity] = useState<
    Record<string, AgentActivity>
  >({});

  useEffect(() => {
    if (!enabled) return;
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
        activityTimer = window.setTimeout(pollActivity, ACTIVITY_INTERVAL_MS);
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
            })),
          );
        } catch {
          // best-effort
        }
      }
      if (!cancelled) {
        changelogTimer = window.setTimeout(pollChangelog, CHANGELOG_INTERVAL_MS);
      }
    };

    void pollActivity();
    void pollChangelog();

    return () => {
      cancelled = true;
      if (activityTimer !== null) window.clearTimeout(activityTimer);
      if (changelogTimer !== null) window.clearTimeout(changelogTimer);
    };
  }, [enabled]);

  return { changelog, agentActivity };
}
