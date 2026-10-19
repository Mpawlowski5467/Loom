import { useEffect, useMemo, useState } from "react";
import {
  getStandupAutomation,
  type StandupAutomation,
} from "@/api/automations";
import {
  getCaptureProcessingPolicy,
  type CaptureProcessingPolicy,
} from "@/api/captures";
import { useApp } from "@/context/app-ctx";
import { useChangelogWindow } from "@/context/useChangelogWindow";
import { computeBoardStats, stateContext } from "./boardStats";

const SCHEDULE_MS = 60_000;

/**
 * Stats and state context for the Board: the deep changelog window, the
 * Standup schedule and the capture processing policy, each refreshed slowly.
 */
export function useBoardData() {
  const { notes, captures } = useApp();
  const { events, loaded } = useChangelogWindow();
  const [automation, setAutomation] = useState<StandupAutomation | null>(null);
  const [policy, setPolicy] = useState<CaptureProcessingPolicy | null>(null);

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

  const stats = useMemo(
    () => computeBoardStats(events, notes, captures, automation),
    [events, notes, captures, automation],
  );
  const ctx = useMemo(
    () => stateContext(automation, policy),
    [automation, policy],
  );
  return { stats, stateCtx: ctx, automation, loaded };
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
