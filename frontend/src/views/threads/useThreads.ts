import { useMemo } from "react";
import { useApp } from "@/context/app-ctx";
import { FEED_WINDOW, useChangelogWindow } from "@/context/useChangelogWindow";
import {
  actionsPerDay,
  councilThread,
  dailyThreads,
  dayDigest,
  standupThreads,
  vaultStats,
  type ThreadItem,
} from "./threadModel";
import { useCouncilSessions } from "./useCouncilChats";

const COUNCIL_ID = /^council-(\d{4}-\d{2}-\d{2})$/;

/**
 * Everything Threads shows: the three lists, the open thread (the newest
 * one when the URL names none), its day digest, and the week's numbers.
 */
export function useThreads(id: string | undefined) {
  const { notes, notesLoaded, captures, communities } = useApp();
  const { events } = useChangelogWindow();
  const sessions = useCouncilSessions();
  const daily = useMemo(() => dailyThreads(notes), [notes]);
  const standups = useMemo(
    () => standupThreads(notes, captures),
    [notes, captures],
  );
  const councils = useMemo(
    () => sessions.dates.map(councilThread),
    [sessions.dates],
  );
  const selected = useMemo((): ThreadItem | null => {
    const council = id ? COUNCIL_ID.exec(id) : null;
    if (council) return councilThread(council[1]!);
    const all = [...daily, ...standups, ...councils];
    return id ? (all.find((t) => t.id === id) ?? null) : (all[0] ?? null);
  }, [id, daily, standups, councils]);
  const digest = useMemo(
    () =>
      selected?.kind === "daily"
        ? dayDigest(selected.date, notes, captures, events, communities.slotOf)
        : null,
    [selected, notes, captures, events, communities.slotOf],
  );
  const week = useMemo(() => actionsPerDay(events), [events]);
  const stats = useMemo(() => vaultStats(notes, events), [notes, events]);
  return {
    daily,
    standups,
    councils,
    councilError: sessions.error,
    selected,
    digest,
    week,
    /** The changelog window was full, so the week may have more actions. */
    capped: events.length >= FEED_WINDOW,
    stats,
    loading: !notesLoaded,
  };
}
