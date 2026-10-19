import { useEffect, useRef, useState } from "react";
import { patchConfig } from "@/api/config";
import {
  getCodexAuthStatus,
  startCodexLogin,
  startOpenRouterOAuth,
} from "@/api/providers";
import { getSettingsProviders, saveSettingsProviders } from "@/api/settings";
import type { CodexAuthStatus } from "@/api/types";
import { useApp } from "@/context/app-ctx";
import {
  createProvider,
  toProviderInput,
  type ProviderName,
} from "../providerModels";
import type { ProviderForms } from "./useProviderForms";
import { describeApiError } from "@/api/client";

const POLL_MS = 1500;
const MAX_POLLS = 80;

function openAuthWindow(url: string) {
  const popup = window.open(
    url,
    "loom-provider-auth",
    "popup,width=560,height=760,noopener,noreferrer",
  );
  if (!popup) window.location.assign(url);
}

/** Delegated sign-in: Codex's local ChatGPT login and OpenRouter's OAuth. */
export function useProviderAuth(forms: ProviderForms) {
  const { refreshConfig } = useApp();
  const { providers, defaultProvider, setMessage } = forms;
  const [authBusy, setAuthBusy] = useState<ProviderName | null>(null);
  const [codexStatus, setCodexStatus] = useState<CodexAuthStatus | null>(null);
  const authPollRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getCodexAuthStatus()
      .then((status) => {
        if (!cancelled) setCodexStatus(status);
      })
      .catch(() => {
        if (!cancelled) {
          setCodexStatus({
            installed: false,
            connected: false,
            auth_mode: null,
            plan_type: null,
            version: null,
            error: "Codex status unavailable",
          });
        }
      });
    return () => {
      cancelled = true;
      if (authPollRef.current !== null) {
        window.clearInterval(authPollRef.current);
      }
    };
  }, []);

  const stopAuthPolling = () => {
    if (authPollRef.current !== null) {
      window.clearInterval(authPollRef.current);
      authPollRef.current = null;
    }
  };

  const persistConnectedProvider = async (name: ProviderName) => {
    const nextProviders = {
      ...providers,
      [name]: providers[name] ?? createProvider(name),
    };
    const names = Object.keys(nextProviders) as ProviderName[];
    const effectiveDefault = defaultProvider || name;
    await saveSettingsProviders(
      names.map((providerName) =>
        toProviderInput(nextProviders[providerName]!, effectiveDefault),
      ),
    );
    await patchConfig({ default_provider: effectiveDefault });
    forms.setProviders(nextProviders);
    forms.setDefaultProvider(effectiveDefault);
    forms.setOpenName(name);
    await refreshConfig();
  };

  const enableConnectedCodex = async () => {
    setAuthBusy("codex");
    try {
      await persistConnectedProvider("codex");
      setMessage(
        "Codex is connected through its local ChatGPT login and ready.",
      );
    } catch (err) {
      setMessage(describeApiError(err, "Could not enable Codex"));
    } finally {
      setAuthBusy(null);
    }
  };

  const connectCodex = async () => {
    if (codexStatus?.connected) {
      await enableConnectedCodex();
      return;
    }
    setAuthBusy("codex");
    setMessage(null);
    try {
      const result = await startCodexLogin();
      openAuthWindow(result.auth_url);
      stopAuthPolling();
      let attempts = 0;
      authPollRef.current = window.setInterval(() => {
        attempts += 1;
        if (attempts > MAX_POLLS) {
          stopAuthPolling();
          setAuthBusy(null);
          setMessage(
            "Codex sign-in is still pending. Use Connect to try again.",
          );
          return;
        }
        void getCodexAuthStatus()
          .then(async (status) => {
            setCodexStatus(status);
            if (!status.connected) return;
            await persistConnectedProvider("codex");
            stopAuthPolling();
            setAuthBusy(null);
            setMessage("Codex connected and ready.");
          })
          .catch((err: unknown) => {
            stopAuthPolling();
            setAuthBusy(null);
            setMessage(describeApiError(err, "Could not enable Codex"));
          });
      }, POLL_MS);
    } catch (err) {
      setAuthBusy(null);
      setMessage(describeApiError(err, "Codex sign-in failed"));
    }
  };

  const connectOpenRouter = async () => {
    setAuthBusy("openrouter");
    setMessage(null);
    try {
      const result = await startOpenRouterOAuth();
      openAuthWindow(result.authorization_url);
      stopAuthPolling();
      let attempts = 0;
      authPollRef.current = window.setInterval(() => {
        attempts += 1;
        if (attempts > MAX_POLLS) {
          stopAuthPolling();
          setAuthBusy(null);
          setMessage(
            "OpenRouter authorization is still pending. Use Connect to try again.",
          );
          return;
        }
        void getSettingsProviders()
          .then((settings) => {
            const connected = settings.providers.find(
              (provider) => provider.name === "openrouter",
            );
            if (!connected?.api_key_set) return;
            forms.patchProvider("openrouter", { apiKeySet: true });
            stopAuthPolling();
            setAuthBusy(null);
            setMessage("OpenRouter connected and encrypted locally.");
          })
          .catch(() => undefined);
      }, POLL_MS);
    } catch (err) {
      setAuthBusy(null);
      setMessage(describeApiError(err, "OpenRouter connection failed"));
    }
  };

  return { authBusy, codexStatus, connectCodex, connectOpenRouter };
}
