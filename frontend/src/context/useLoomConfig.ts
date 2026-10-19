import { useCallback, useEffect, useState } from "react";
import { getConfig } from "../api/config";
import { completeOnboarding as completeOnboardingApi } from "../api/onboarding";
import { ApiError } from "../api/client";
import type { LoomConfigPublic, OnboardingCompleteRequest } from "../api/types";

export interface UseLoomConfigResult {
  config: LoomConfigPublic | null;
  configLoading: boolean;
  configError: string | null;
  offline: boolean;
  refreshConfig: () => Promise<void>;
  onboardingComplete: boolean;
  completeOnboarding: (payload: OnboardingCompleteRequest) => Promise<void>;
}

/**
 * Owns the global config handshake with the backend: load `/api/config`,
 * track offline state, and complete onboarding. Appearance (theme, accent,
 * fonts) is owned by `theme/ThemeProvider`, not by this hook.
 */
export function useLoomConfig(): UseLoomConfigResult {
  const [config, setConfig] = useState<LoomConfigPublic | null>(null);
  const [configLoading, setConfigLoading] = useState<boolean>(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [offline, setOffline] = useState<boolean>(false);

  const refreshConfig = useCallback(async () => {
    setConfigError(null);
    try {
      const next = await getConfig();
      setConfig(next);
      setOffline(false);
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
  }, []);

  useEffect(() => {
    void refreshConfig();
  }, [refreshConfig]);

  const completeOnboarding = useCallback(
    async (payload: OnboardingCompleteRequest) => {
      setConfigError(null);
      try {
        const result = await completeOnboardingApi(payload);
        setConfig(result);
        setOffline(false);
      } finally {
        setConfigLoading(false);
      }
    },
    [],
  );

  return {
    config,
    configLoading,
    configError,
    offline,
    refreshConfig,
    onboardingComplete: config?.onboarding.completed ?? false,
    completeOnboarding,
  };
}
