import { useEffect, useState } from "react";

export type ShellPhase = "loading" | "timeout" | "onboarding" | "ready";

// How long to wait on a config that never resolves before showing an
// actionable fallback instead of an indefinite spinner.
export const BOOT_TIMEOUT_MS = 10_000;

/**
 * Flip ``true`` once ``BOOT_TIMEOUT_MS`` elapses while config is still loading
 * and absent. The timer only runs while ``stillBooting`` and is cleared on
 * unmount (or when ``stillBooting`` goes false). A stale ``true`` after config
 * arrives is harmless — ``decidePhase`` only consults ``timedOut`` inside the
 * still-loading branch. Exported separately from the component so it can be
 * driven with fake timers in tests.
 */
export function useBootTimeout(stillBooting: boolean): boolean {
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!stillBooting) return;
    const id = window.setTimeout(() => setTimedOut(true), BOOT_TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, [stillBooting]);

  return timedOut;
}

export function decidePhase(args: {
  config: boolean;
  configLoading: boolean;
  offline: boolean;
  onboardingComplete: boolean;
  timedOut?: boolean;
}): ShellPhase {
  // Offline at boot — we never got a config. Treat as already-onboarded so the
  // user can at least poke around the seeded UI; the offline banner makes the
  // state clear.
  if (args.offline && !args.config) return "ready";
  if (args.configLoading && !args.config) {
    // The backend isn't answering — show an actionable fallback rather than an
    // indefinite spinner.
    return args.timedOut ? "timeout" : "loading";
  }
  return args.onboardingComplete ? "ready" : "onboarding";
}
