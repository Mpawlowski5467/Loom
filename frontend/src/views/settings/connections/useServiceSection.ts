import { useEffect, useRef, useState } from "react";
import { useApp } from "@/context/app-ctx";
import type {
  ServiceSectionValues,
  ServiceSyncOutcome,
  ServiceTestOutcome,
} from "./types";
import { describeApiError } from "@/api/client";

export interface ServiceSectionOptions {
  serviceLabel: string;
  savedEnabled: boolean;
  savedIntervalMinutes: number;
  savedLookbackDays: number;
  savedCalendarIdsText: string;
  disabled: boolean;
  onSave: (values: ServiceSectionValues) => Promise<void>;
  onTest: () => Promise<ServiceTestOutcome>;
  onSync: () => Promise<ServiceSyncOutcome>;
}

type SavedValues = Pick<
  ServiceSectionOptions,
  | "savedEnabled"
  | "savedIntervalMinutes"
  | "savedLookbackDays"
  | "savedCalendarIdsText"
>;

/** Draft state and Save / Test / Sync actions for one connector service. */
export function useServiceSection(options: ServiceSectionOptions) {
  const { serviceLabel, onSave, onTest, onSync } = options;
  const { pushToast } = useApp();
  const [enabled, setEnabled] = useState(options.savedEnabled);
  const [intervalMinutes, setIntervalMinutes] = useState(
    String(options.savedIntervalMinutes),
  );
  const [lookbackDays, setLookbackDays] = useState(
    String(options.savedLookbackDays),
  );
  const [calendarIds, setCalendarIds] = useState(options.savedCalendarIdsText);
  const [busy, setBusy] = useState<"save" | "test" | "sync" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<ServiceTestOutcome | null>(null);
  const [errorLines, setErrorLines] = useState<string[]>([]);
  const actionAbort = useRef<AbortController | null>(null);

  // Re-sync drafts whenever the saved values change (load, save, connect).
  // Scalar comparisons only — a fresh object identity every render would
  // clobber the user's in-flight edits.
  const saved: SavedValues = {
    savedEnabled: options.savedEnabled,
    savedIntervalMinutes: options.savedIntervalMinutes,
    savedLookbackDays: options.savedLookbackDays,
    savedCalendarIdsText: options.savedCalendarIdsText,
  };
  const [synced, setSynced] = useState(saved);
  if (
    synced.savedEnabled !== saved.savedEnabled ||
    synced.savedIntervalMinutes !== saved.savedIntervalMinutes ||
    synced.savedLookbackDays !== saved.savedLookbackDays ||
    synced.savedCalendarIdsText !== saved.savedCalendarIdsText
  ) {
    setSynced(saved);
    setEnabled(options.savedEnabled);
    setIntervalMinutes(String(options.savedIntervalMinutes));
    setLookbackDays(String(options.savedLookbackDays));
    setCalendarIds(options.savedCalendarIdsText);
  }

  useEffect(
    () => () => {
      actionAbort.current?.abort();
      actionAbort.current = null;
    },
    [],
  );

  const draft = (): ServiceSectionValues => ({
    enabled,
    intervalMinutes: Math.round(Number(intervalMinutes)) || 15,
    lookbackDays: Math.round(Number(lookbackDays)) || 7,
    calendarIds: calendarIds
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  });

  const begin = (action: "save" | "test" | "sync"): AbortController => {
    actionAbort.current?.abort();
    const controller = new AbortController();
    actionAbort.current = controller;
    setBusy(action);
    setError(null);
    return controller;
  };

  const end = (controller: AbortController) => {
    if (actionAbort.current === controller) {
      actionAbort.current = null;
      setBusy(null);
    }
  };

  const save = async () => {
    begin("save");
    try {
      await onSave(draft());
      pushToast({
        icon: "✓",
        agent: "connector",
        body: `${serviceLabel} saved`,
      });
    } catch (err) {
      setError(describeApiError(err, "Could not save settings"));
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    const controller = begin("test");
    try {
      // Test runs against the saved config — persist the draft first so the
      // toggle/interval edits apply (same pattern as the iCal card).
      await onSave(draft());
      if (controller.signal.aborted) return;
      const result = await onTest();
      setTestResult(result);
      if (result.ok) {
        pushToast({
          icon: "◫",
          agent: "connector",
          body: `${serviceLabel} connected — ${result.account || "account reachable"}`,
        });
      }
    } catch (err) {
      if ((err as DOMException)?.name !== "AbortError") {
        setError(describeApiError(err, `${serviceLabel} test failed`));
      }
    } finally {
      end(controller);
    }
  };

  const sync = async () => {
    const controller = begin("sync");
    try {
      await onSave(draft());
      if (controller.signal.aborted) return;
      const result = await onSync();
      setErrorLines(result.errorLines);
      pushToast({
        icon: "↷",
        agent: "connector",
        body: `${serviceLabel} sync: ${result.created} new capture${result.created === 1 ? "" : "s"}, ${result.deduplicated} already in Inbox${result.failed ? `, ${result.failed} failed` : ""}`,
      });
    } catch (err) {
      if ((err as DOMException)?.name !== "AbortError") {
        setError(describeApiError(err, `${serviceLabel} sync failed`));
      }
    } finally {
      end(controller);
    }
  };

  return {
    enabled,
    setEnabled,
    intervalMinutes,
    setIntervalMinutes,
    lookbackDays,
    setLookbackDays,
    calendarIds,
    setCalendarIds,
    busy,
    error,
    testResult,
    errorLines,
    inactive: options.disabled || busy !== null,
    save,
    test,
    sync,
  };
}
