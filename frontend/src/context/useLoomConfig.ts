import { useCallback, useEffect, useRef, useState } from "react";
import { getConfig, patchConfig } from "../api/config";
import { completeOnboarding as completeOnboardingApi } from "../api/onboarding";
import { ApiError } from "../api/client";
import type { LoomConfigPublic, OnboardingCompleteRequest } from "../api/types";
import type { Toast } from "../data/types";
import { applyTheme, readInitialTheme } from "../theme/applyTheme";
import {
  osThemeMode,
  readFollowOsTheme,
  subscribeOsTheme,
  themeForOsMode,
  writeFollowOsTheme,
} from "../theme/themeAuto";
import type { ThemeName } from "../theme/themes";

type PushToast = (toast: Omit<Toast, "id">) => void;

export interface UseLoomConfigResult {
  theme: ThemeName;
  setTheme: (t: ThemeName) => Promise<void>;
  /** Whether the theme tracks the OS light/dark preference. */
  followOsTheme: boolean;
  setFollowOsTheme: (on: boolean) => void;
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
  const [followOsTheme, setFollowOsState] = useState<boolean>(() =>
    readFollowOsTheme(),
  );
  const [theme, setThemeState] = useState<ThemeName>(() => {
    const stored = readInitialTheme();
    // When following the OS, the OS preference is the source of truth on boot.
    return readFollowOsTheme()
      ? themeForOsMode(osThemeMode(), stored)
      : stored;
  });
  const [config, setConfig] = useState<LoomConfigPublic | null>(null);
  const [configLoading, setConfigLoading] = useState<boolean>(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [offline, setOffline] = useState<boolean>(false);

  const toastedSyncRef = useRef<boolean>(false);
  // Latest values the OS-listener effect needs without re-subscribing.
  const followRef = useRef(followOsTheme);
  followRef.current = followOsTheme;
  const themeRef = useRef(theme);
  themeRef.current = theme;

  // Paint + persist a theme to the backend without touching the follow-OS flag.
  // Used by both the public setter and the OS auto-switch.
  const persistTheme = useCallback(
    async (next: ThemeName) => {
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

  const refreshConfig = useCallback(async () => {
    setConfigError(null);
    try {
      const next = await getConfig();
      setConfig(next);
      setOffline(false);
      // While following the OS, the OS preference wins — don't let the server
      // theme override the auto-resolved one.
      if (!followRef.current && next.ui.theme !== themeRef.current) {
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
  }, [pushToast]);

  useEffect(() => {
    void refreshConfig();
  }, [refreshConfig]);

  // App-wide OS theme tracking: while followOsTheme is on, adopt the matching
  // theme now and on every OS light/dark flip. Lives here (not in the settings
  // panel) so it stays active no matter which view is open.
  useEffect(() => {
    if (!followOsTheme) return;
    const sync = () => {
      const next = themeForOsMode(osThemeMode(), themeRef.current);
      if (next !== themeRef.current) void persistTheme(next);
    };
    sync();
    return subscribeOsTheme(sync);
  }, [followOsTheme, persistTheme]);

  const setTheme = useCallback(
    async (next: ThemeName) => {
      // A manual theme pick is an override — stop following the OS.
      if (followRef.current) {
        setFollowOsState(false);
        writeFollowOsTheme(false);
      }
      await persistTheme(next);
    },
    [persistTheme],
  );

  const setFollowOsTheme = useCallback((on: boolean) => {
    setFollowOsState(on);
    writeFollowOsTheme(on);
    // The effect above reacts to the state change and resolves the theme.
  }, []);

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
    followOsTheme,
    setFollowOsTheme,
    config,
    configLoading,
    configError,
    offline,
    refreshConfig,
    onboardingComplete: config?.onboarding.completed ?? false,
    completeOnboarding,
  };
}
