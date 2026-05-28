import { useCallback, useEffect, useRef, useState } from "react";
import { getConfig, patchConfig } from "../api/config";
import { completeOnboarding as completeOnboardingApi } from "../api/onboarding";
import { ApiError } from "../api/client";
import type { LoomConfigPublic, OnboardingCompleteRequest } from "../api/types";
import type { Toast } from "../data/types";
import { applyTheme, readInitialTheme } from "../theme/applyTheme";
import type { ThemeName } from "../theme/themes";

type PushToast = (toast: Omit<Toast, "id">) => void;

export interface UseLoomConfigResult {
  theme: ThemeName;
  setTheme: (t: ThemeName) => Promise<void>;
  config: LoomConfigPublic | null;
  configLoading: boolean;
  configError: string | null;
  offline: boolean;
  refreshConfig: () => Promise<void>;
  onboardingComplete: boolean;
  completeOnboarding: (payload: OnboardingCompleteRequest) => Promise<void>;
}

/**
 * Owns the config + theme handshake with the backend.
 *
 * Theme conflict policy: paint localStorage immediately (zero-flash boot,
 * already done by main.tsx), then async-fetch the server's truth and
 * reconcile. If the server differs we repaint and surface a toast — the
 * server wins on load, but the user's local pick is never silently dropped.
 */
export function useLoomConfig(pushToast: PushToast): UseLoomConfigResult {
  const [theme, setThemeState] = useState<ThemeName>(() => readInitialTheme());
  const [config, setConfig] = useState<LoomConfigPublic | null>(null);
  const [configLoading, setConfigLoading] = useState<boolean>(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [offline, setOffline] = useState<boolean>(false);

  const toastedSyncRef = useRef<boolean>(false);

  const refreshConfig = useCallback(async () => {
    setConfigError(null);
    try {
      const next = await getConfig();
      setConfig(next);
      setOffline(false);
      if (next.ui.theme !== theme) {
        applyTheme(next.ui.theme);
        setThemeState(next.ui.theme);
        if (!toastedSyncRef.current) {
          toastedSyncRef.current = true;
          pushToast({
            icon: "◐",
            agent: "loom",
            body: `Theme synced — switched to ${next.ui.theme}.`,
          });
        }
      }
    } catch (err) {
      if (err instanceof ApiError && err.offline) {
        setOffline(true);
        setConfigError("Backend unreachable — running with local cache.");
      } else {
        setConfigError(
          err instanceof Error ? err.message : "Failed to load config",
        );
      }
    } finally {
      setConfigLoading(false);
    }
    // theme intentionally omitted from deps: this is a one-shot reconciliation
    // against the latest fetched value; including it would loop after we set it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushToast]);

  useEffect(() => {
    void refreshConfig();
  }, [refreshConfig]);

  const setTheme = useCallback(
    async (next: ThemeName) => {
      // Optimistic — paint immediately so the user feels the change.
      applyTheme(next);
      setThemeState(next);
      try {
        const updated = await patchConfig({ theme: next });
        setConfig(updated);
        setOffline(false);
      } catch (err) {
        if (err instanceof ApiError && err.offline) {
          setOffline(true);
          pushToast({
            icon: "⊘",
            agent: "loom",
            body: "Theme saved locally — backend unreachable.",
          });
        } else {
          pushToast({
            icon: "!",
            agent: "loom",
            body: `Theme not synced: ${
              err instanceof Error ? err.message : "server rejected the update"
            }`,
          });
        }
      }
    },
    [pushToast],
  );

  const completeOnboarding = useCallback(
    async (payload: OnboardingCompleteRequest) => {
      setConfigError(null);
      try {
        const result = await completeOnboardingApi(payload);
        setConfig(result);
        setOffline(false);
        if (result.ui.theme !== theme) {
          applyTheme(result.ui.theme);
          setThemeState(result.ui.theme);
        }
      } finally {
        setConfigLoading(false);
      }
    },
    [theme],
  );

  return {
    theme,
    setTheme,
    config,
    configLoading,
    configError,
    offline,
    refreshConfig,
    onboardingComplete: config?.onboarding.completed ?? false,
    completeOnboarding,
  };
}
