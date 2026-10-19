import { useEffect, useMemo, useRef, useState } from "react";
import { patchConfig } from "@/api/config";
import { testProvider } from "@/api/providers";
import { getSettingsProviders, saveSettingsProviders } from "@/api/settings";
import type { TestProviderResponse } from "@/api/types";
import { useApp } from "@/context/app-ctx";
import {
  createProvider,
  PROVIDER_BY_NAME,
  PROVIDERS,
  toProviderInput,
  type ProviderForm,
  type ProviderName,
} from "../providerModels";
import { hydrateProviders, missingKeyLabels } from "./providerHelpers";
import { describeApiError } from "@/api/client";

/** The provider forms: hydration, edits, the default, tests and saving. */
export function useProviderForms() {
  const { config, refreshConfig, pushToast } = useApp();
  const [providers, setProviders] = useState<Record<string, ProviderForm>>({});
  const [openName, setOpenName] = useState<ProviderName>("codex");
  const [defaultProvider, setDefaultProvider] = useState<ProviderName | "">("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tests, setTests] = useState<
    Partial<Record<ProviderName, TestProviderResponse>>
  >({});
  const [testing, setTesting] = useState<string | null>(null);
  // Hydrate the forms only once. Without this, changing the default-provider
  // radio (which refreshes config) would re-fetch and wipe unsaved key edits.
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (hydratedRef.current) return;
    let cancelled = false;
    getSettingsProviders()
      .then((result) => {
        if (cancelled) return;
        const next = hydrateProviders(result.providers);
        const configured = Object.keys(next) as ProviderName[];
        const initial = config?.default_provider as ProviderName | undefined;
        setProviders(next);
        setDefaultProvider(
          initial && next[initial] ? initial : (configured[0] ?? ""),
        );
        setOpenName(configured[0] ?? "codex");
        hydratedRef.current = true;
      })
      .catch((err) => {
        if (!cancelled) {
          setMessage(describeApiError(err, "Provider load failed"));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [config?.default_provider]);

  const configuredNames = useMemo(
    () => PROVIDERS.map((p) => p.name).filter((name) => providers[name]),
    [providers],
  );

  const embedProviderMissing = useMemo(() => {
    if (configuredNames.length === 0) return false;
    return !configuredNames.some(
      (name) =>
        PROVIDER_BY_NAME.get(name)?.supportsEmbed &&
        Boolean(providers[name]?.embedModel.trim()),
    );
  }, [configuredNames, providers]);

  const patchProvider = (name: ProviderName, patch: Partial<ProviderForm>) => {
    setProviders((prev) => ({
      ...prev,
      [name]: { ...(prev[name] ?? createProvider(name)), ...patch },
    }));
    setTests((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const addProvider = (name: ProviderName) => {
    setProviders((prev) => ({
      ...prev,
      [name]: prev[name] ?? createProvider(name),
    }));
    setOpenName(name);
    if (!defaultProvider) setDefaultProvider(name);
  };

  const removeProvider = (name: ProviderName) => {
    if (configuredNames.length <= 1) return;
    const remaining = configuredNames.filter((n) => n !== name);
    setProviders((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
    if (defaultProvider === name) setDefaultProvider(remaining[0] ?? "");
  };

  const selectDefault = async (name: ProviderName) => {
    setDefaultProvider(name);
    try {
      await patchConfig({ default_provider: name });
      await refreshConfig();
    } catch (err) {
      pushToast({
        icon: "!",
        agent: "loom",
        body: describeApiError(err, "Default provider not saved."),
      });
    }
  };

  const runTest = async (name: ProviderName) => {
    const provider = providers[name];
    if (!provider) return;
    const meta = PROVIDER_BY_NAME.get(name);
    setTesting(name);
    try {
      const result = await testProvider(name, {
        api_key: provider.apiKey,
        host: provider.host,
        base_url: meta?.supportsBaseUrl ? provider.baseUrl : "",
      });
      setTests((prev) => ({ ...prev, [name]: result }));
    } catch (err) {
      // A thrown call (network error, 5xx) would otherwise leave the spinner
      // stopping with no result. Surface it as a failed test instead.
      setTests((prev) => ({
        ...prev,
        [name]: {
          ok: false,
          latency_ms: 0,
          error: describeApiError(err, "Test failed"),
        },
      }));
    } finally {
      setTesting(null);
    }
  };

  const save = async () => {
    if (configuredNames.length === 0) {
      setMessage("At least one provider must be configured.");
      return;
    }
    const missing = missingKeyLabels(configuredNames, providers);
    if (missing.length > 0) {
      setMessage(`Add an API key before saving: ${missing.join(", ")}.`);
      return;
    }
    setSaving(true);
    setMessage(null);
    const effectiveDefault = defaultProvider || configuredNames[0]!;
    try {
      const payload = configuredNames.map((name) =>
        toProviderInput(providers[name]!, effectiveDefault),
      );
      await saveSettingsProviders(payload);
      await patchConfig({ default_provider: effectiveDefault });
      await refreshConfig();
      setMessage("Provider settings saved.");
    } catch (err) {
      setMessage(describeApiError(err, "Provider save failed"));
    } finally {
      setSaving(false);
    }
  };

  return {
    providers,
    setProviders,
    openName,
    setOpenName,
    defaultProvider,
    setDefaultProvider,
    loading,
    saving,
    message,
    setMessage,
    tests,
    testing,
    configuredNames,
    embedProviderMissing,
    patchProvider,
    addProvider,
    removeProvider,
    selectDefault,
    runTest,
    save,
  };
}

export type ProviderForms = ReturnType<typeof useProviderForms>;
