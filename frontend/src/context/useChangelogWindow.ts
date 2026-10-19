import { useEffect, useState } from "react";
import { fetchChangelogFeed, toAgentEvent } from "@/api/changelog";
import type { AgentEvent } from "@/data/types";
import { useApp } from "./app-ctx";

/** The changelog feed's deepest window: each agent's 7 latest day files. */
export const FEED_WINDOW = 200;
const FEED_MS = 20_000;

/**
 * About a week of agent activity, refreshed slowly while the tab is
 * visible. Falls back to the app's shorter (or demo) changelog while the
 * deep feed is unavailable. `loaded` is true once the deep feed answered.
 */
export function useChangelogWindow(): {
  events: AgentEvent[];
  loaded: boolean;
} {
  const { changelog } = useApp();
  const [feed, setFeed] = useState<AgentEvent[] | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    let timer = 0;
    const tick = () => {
      if (!document.hidden)
        fetchChangelogFeed(FEED_WINDOW, ctrl.signal).then(
          (rows) => !ctrl.signal.aborted && setFeed(rows.map(toAgentEvent)),
          () => {},
        );
      timer = window.setTimeout(tick, FEED_MS);
    };
    tick();
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, []);
  return { events: feed ?? changelog, loaded: feed !== null };
}
