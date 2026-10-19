import { useCallback, useEffect, useRef, useState } from "react";
import {
  getStandupAutomation,
  syncCalendar,
  testCalendar,
  updateStandupAutomation,
  type CalendarTestResult,
  type StandupAutomation,
} from "@/api/automations";
import { useApp } from "@/context/app-ctx";
import { describeApiError } from "@/api/client";

function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function localDate(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * The Standup schedule and the iCalendar feed: one saved config shared by
 * the Daily Standup and Calendar feed cards, saved together.
 */
export function useStandupAutomation() {
  const { pushToast } = useApp();
  const [automation, setAutomation] = useState<StandupAutomation | null>(null);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [runTime, setRunTime] = useState("08:00");
  const [timezone, setTimezone] = useState(browserTimezone);
  const [calendarEnabled, setCalendarEnabled] = useState(false);
  const [feedUrl, setFeedUrl] = useState("");
  const [calendarName, setCalendarName] = useState("Calendar");
  const [includeInStandup, setIncludeInStandup] = useState(true);
  const [createCaptures, setCreateCaptures] = useState(true);
  const [testResult, setTestResult] = useState<CalendarTestResult | null>(null);
  const [busy, setBusy] = useState<
    "save" | "test" | "sync" | "disconnect" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const actionAbort = useRef<AbortController | null>(null);

  const apply = useCallback((next: StandupAutomation) => {
    setAutomation(next);
    setScheduleEnabled(next.schedule.enabled);
    setRunTime(next.schedule.run_time);
    setTimezone(
      next.schedule.timezone === "UTC" && !next.schedule.enabled
        ? browserTimezone()
        : next.schedule.timezone,
    );
    setCalendarEnabled(next.calendar.enabled);
    setCalendarName(next.calendar.name);
    setIncludeInStandup(next.calendar.include_in_standup);
    setCreateCaptures(next.calendar.create_captures);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    getStandupAutomation(controller.signal)
      .then(apply)
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(describeApiError(err, "Connections could not be loaded"));
      });
    return () => {
      controller.abort();
      actionAbort.current?.abort();
      actionAbort.current = null;
    };
  }, [apply]);

  const persist = useCallback(
    async (signal?: AbortSignal): Promise<StandupAutomation> => {
      const next = await updateStandupAutomation({
        schedule: {
          enabled: scheduleEnabled,
          run_time: runTime,
          timezone,
        },
        calendar: {
          enabled: calendarEnabled,
          name: calendarName,
          include_in_standup: includeInStandup,
          create_captures: createCaptures,
          ...(feedUrl.trim() ? { feed_url: feedUrl.trim() } : {}),
        },
      });
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      setFeedUrl("");
      apply(next);
      return next;
    },
    [
      apply,
      calendarEnabled,
      calendarName,
      createCaptures,
      feedUrl,
      includeInStandup,
      runTime,
      scheduleEnabled,
      timezone,
    ],
  );

  const save = async () => {
    setBusy("save");
    setError(null);
    try {
      await persist();
      pushToast({
        icon: "✓",
        agent: "standup",
        body: "Standup automation saved",
      });
    } catch (err) {
      setError(describeApiError(err, "Could not save connection"));
    } finally {
      setBusy(null);
    }
  };

  /** Save first, then run a feed action; a newer action aborts this one. */
  const runFeedAction = async (
    action: "test" | "sync",
    work: (signal: AbortSignal) => Promise<void>,
    fallback: string,
  ) => {
    actionAbort.current?.abort();
    const controller = new AbortController();
    actionAbort.current = controller;
    setBusy(action);
    setError(null);
    try {
      await persist(controller.signal);
      if (controller.signal.aborted) return;
      await work(controller.signal);
    } catch (err) {
      if ((err as DOMException)?.name !== "AbortError") {
        setError(err instanceof Error ? err.message : fallback);
      }
    } finally {
      if (actionAbort.current === controller) {
        actionAbort.current = null;
        setBusy(null);
      }
    }
  };

  const test = () =>
    runFeedAction(
      "test",
      async (signal) => {
        const result = await testCalendar(localDate(), signal);
        setTestResult(result);
        pushToast({
          icon: "◫",
          agent: "standup",
          body: `Calendar connected — ${result.event_count} event${result.event_count === 1 ? "" : "s"} today`,
        });
      },
      "Calendar test failed",
    );

  const sync = () =>
    runFeedAction(
      "sync",
      async (signal) => {
        const result = await syncCalendar(localDate(), signal);
        pushToast({
          icon: "↷",
          agent: "standup",
          body: `Calendar sync: ${result.created} new, ${result.deduplicated} already in Inbox`,
        });
      },
      "Calendar sync failed",
    );

  const disconnect = async () => {
    setBusy("disconnect");
    setError(null);
    try {
      const next = await updateStandupAutomation({
        calendar: { enabled: false, clear_feed_url: true },
      });
      apply(next);
      setFeedUrl("");
      setTestResult(null);
    } catch (err) {
      setError(describeApiError(err, "Could not disconnect calendar"));
    } finally {
      setBusy(null);
    }
  };

  return {
    automation,
    scheduleEnabled,
    setScheduleEnabled,
    runTime,
    setRunTime,
    timezone,
    setTimezone,
    calendarEnabled,
    setCalendarEnabled,
    feedUrl,
    setFeedUrl,
    calendarName,
    setCalendarName,
    includeInStandup,
    setIncludeInStandup,
    createCaptures,
    setCreateCaptures,
    testResult,
    busy,
    error,
    save,
    test,
    sync,
    disconnect,
  };
}

export type StandupAutomationState = ReturnType<typeof useStandupAutomation>;
