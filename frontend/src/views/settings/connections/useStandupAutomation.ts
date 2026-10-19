import { useCallback, useEffect, useRef, useState } from "react";
import {
  getStandupAutomation,
  syncCalendar,
  testCalendar,
  updateStandupAutomation,
  type CalendarBridgeConfig,
  type CalendarTestResult,
  type StandupAutomation,
  type StandupScheduleConfig,
} from "@/api/automations";
import { useApp } from "@/context/app-ctx";
import { describeApiError } from "@/api/client";
import type { StatusTone } from "@/views/settings/kit/StatusLine";

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

/** The schedule fields as the Daily Standup card shows them. */
interface ScheduleDraft {
  enabled: boolean;
  runTime: string;
  timezone: string;
}

function scheduleDraft(schedule: StandupScheduleConfig): ScheduleDraft {
  return {
    enabled: schedule.enabled,
    runTime: schedule.run_time,
    // A schedule never turned on still has the backend's UTC default.
    timezone:
      schedule.timezone === "UTC" && !schedule.enabled
        ? browserTimezone()
        : schedule.timezone,
  };
}

/**
 * The Standup schedule and the iCalendar feed. They share one saved config,
 * but each card saves only its half: the Daily Standup card's Save sends
 * `schedule`; the Calendar feed card's Save, Test and Sync send `calendar`.
 * Each applies only its half of the response, so saving one card never
 * saves or resets the other card's unsaved edits.
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
  const [savedSchedule, setSavedSchedule] = useState<ScheduleDraft | null>(
    null,
  );
  const [scheduleStatus, setScheduleStatus] = useState<{
    tone: StatusTone;
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState<
    "schedule" | "save" | "test" | "sync" | "disconnect" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const actionAbort = useRef<AbortController | null>(null);

  const applySchedule = useCallback((schedule: StandupScheduleConfig) => {
    const draft = scheduleDraft(schedule);
    setSavedSchedule(draft);
    setScheduleEnabled(draft.enabled);
    setRunTime(draft.runTime);
    setTimezone(draft.timezone);
  }, []);

  const applyCalendar = useCallback((calendar: CalendarBridgeConfig) => {
    setCalendarEnabled(calendar.enabled);
    setCalendarName(calendar.name);
    setIncludeInStandup(calendar.include_in_standup);
    setCreateCaptures(calendar.create_captures);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    getStandupAutomation(controller.signal)
      .then((next) => {
        setAutomation(next);
        applySchedule(next.schedule);
        applyCalendar(next.calendar);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(describeApiError(err, "Connections could not be loaded"));
      });
    return () => {
      controller.abort();
      actionAbort.current?.abort();
      actionAbort.current = null;
    };
  }, [applyCalendar, applySchedule]);

  const scheduleDirty =
    savedSchedule !== null &&
    (scheduleEnabled !== savedSchedule.enabled ||
      runTime !== savedSchedule.runTime ||
      timezone !== savedSchedule.timezone);

  const saveSchedule = async () => {
    setBusy("schedule");
    setScheduleStatus(null);
    try {
      const next = await updateStandupAutomation({
        schedule: { enabled: scheduleEnabled, run_time: runTime, timezone },
      });
      setAutomation(next);
      applySchedule(next.schedule);
      setScheduleStatus({ tone: "ok", text: "Schedule saved." });
    } catch (err) {
      setScheduleStatus({
        tone: "error",
        text: describeApiError(err, "Could not save the schedule"),
      });
    } finally {
      setBusy(null);
    }
  };

  /** Save the calendar half; schedule edits stay as typed. */
  const persist = useCallback(
    async (signal?: AbortSignal): Promise<StandupAutomation> => {
      const next = await updateStandupAutomation({
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
      setAutomation(next);
      applyCalendar(next.calendar);
      return next;
    },
    [
      applyCalendar,
      calendarEnabled,
      calendarName,
      createCaptures,
      feedUrl,
      includeInStandup,
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
        body: "Calendar feed saved",
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
      setAutomation(next);
      applyCalendar(next.calendar);
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
    scheduleDirty,
    scheduleStatus,
    saveSchedule,
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
