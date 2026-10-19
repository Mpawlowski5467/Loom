import { useEffect, useMemo, useState } from "react";
import {
  getStandupAutomation,
  type StandupAutomation,
} from "@/api/automations";
import {
  getCaptureProcessingPolicy,
  type CaptureProcessingPolicy,
} from "@/api/captures";
import { fetchChangelogFeed, toAgentEvent } from "@/api/changelog";
import { useApp } from "@/context/app-ctx";
import type { AgentEvent } from "@/data/types";
import { computeBoardStats, FEED_WINDOW, stateContext } from "./boardStats";

const FEED_MS = 20_000;
const SCHEDULE_MS = 60_000;

/**
 * Stats and state context for the Board: the deep changelog window, the
 * Standup schedule and the capture processing policy, each refreshed slowly.
 * Falls back to the app's (shorter or demo) changelog when the feed is down.
 */
export function useBoardData() {
  const { changelog, notes, captures } = useApp();
  const [feed, setFeed] = useState<AgentEvent[] | null>(null);
  const [automation, setAutomation] = useState<StandupAutomation | null>(null);
  const [policy, setPolicy] = useState<CaptureProcessingPolicy | null>(null);

  useEffect(
    () =>
      poll(FEED_MS, (signal) =>
        fetchChangelogFeed(FEED_WINDOW, signal).then((rows) =>
          setFeed(rows.map(toAgentEvent)),
        ),
      ),
    [],
  );
  useEffect(
    () =>
      poll(SCHEDULE_MS, (signal) =>
        Promise.allSettled([
          getStandupAutomation(signal).then(setAutomation),
          getCaptureProcessingPolicy(signal).then(setPolicy),
        ]),
      ),
    [],
  );

  const events = feed ?? changelog;
  const stats = useMemo(
    () => computeBoardStats(events, notes, captures, automation),
    [events, notes, captures, automation],
  );
  const ctx = useMemo(
    () => stateContext(automation, policy),
    [automation, policy],
  );
  return { stats, stateCtx: ctx, automation, loaded: feed !== null };
}

/** Run `load` now and every `ms` while the tab is visible; abort on cleanup. */
function poll(ms: number, load: (signal: AbortSignal) => Promise<unknown>) {
  const ctrl = new AbortController();
  let timer = 0;
  const tick = () => {
    if (!document.hidden) load(ctrl.signal).catch(() => {});
    timer = window.setTimeout(tick, ms);
  };
  tick();
  return () => {
    ctrl.abort();
    window.clearTimeout(timer);
  };
}
