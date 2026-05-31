import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Save } from "lucide-react";
import { patchConfig } from "../../api/config";
import { testProvider } from "../../api/providers";
import {
  getSettingsProviders,
  saveSettingsProviders,
} from "../../api/settings";
import type { TestProviderResponse } from "../../api/types";
import { useApp } from "../../context/app-ctx";
import { ProviderAccordion } from "./ProviderAccordion";
import {
  createProvider,
  PROVIDER_BY_NAME,
  PROVIDERS,
  toProviderInput,
  type ProviderForm,
  type ProviderName,
} from "./providerModels";

export function ProvidersSection(): ReactNode {
  const { config, refreshConfig, pushToast } = useApp();
  const [providers, setProviders] = useState<Record<string, ProviderForm>>({});
  const [openName, setOpenName] = useState<ProviderName>("openai");
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
        setOpenName(configured[0] ?? "openai");
        hydratedRef.current = true;
      })
      .catch((err) => {
        if (!cancelled) {
          setMessage(
            err instanceof Error ? err.message : "Provider load failed",
          );
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
      (name) => PROVIDER_BY_NAME.get(name)?.supportsEmbed,
    );
  }, [configuredNames]);

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
        body:
          err instanceof Error ? err.message : "Default provider not saved.",
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
          error: err instanceof Error ? err.message : "Test failed",
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
    // Block empty keys: agents fail with a cryptic error later otherwise.
    // A key counts if it's typed now or already stored on the backend.
    const missingKeys = configuredNames.filter((name) => {
      if (name === "ollama") return false;
      const provider = providers[name];
      return !provider?.apiKey.trim() && !provider?.apiKeySet;
    });
    if (missingKeys.length > 0) {
      const labels = missingKeys.map(
        (name) => PROVIDER_BY_NAME.get(name)?.label ?? name,
      );
      setMessage(`Add an API key before saving: ${labels.join(", ")}.`);
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
      setMessage(err instanceof Error ? err.message : "Provider save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-panel">
      <div className="settings-kicker">Providers</div>
      <h1 className="settings-title">AI Providers</h1>
      <DefaultProviderPicker
        names={configuredNames}
        value={defaultProvider}
        onChange={selectDefault}
      />
      {embedProviderMissing && (
        <div className="settings-banner settings-banner-warn" role="status">
          <strong>No embedding provider.</strong> The configured providers are
          chat-only — Loom's index will fail. Add OpenAI or Ollama to enable
          search and graph linking.
        </div>
      )}
      <div className="settings-provider-list">
        {PROVIDERS.map((meta) => (
          <ProviderAccordion
            key={meta.name}
            meta={meta}
            provider={providers[meta.name]}
            open={openName === meta.name}
            count={configuredNames.length}
            test={tests[meta.name]}
            testing={testing === meta.name}
            onToggle={() => setOpenName(meta.name)}
            onAdd={() => addProvider(meta.name)}
            onPatch={(patch) => patchProvider(meta.name, patch)}
            onRemove={() => removeProvider(meta.name)}
            onTest={() => void runTest(meta.name)}
          />
        ))}
      </div>
      <div className="settings-actions">
        <button
          className="btn btn-md btn-active"
          onClick={() => void save()}
          disabled={saving || loading}
        >
          <Save size={14} aria-hidden="true" />
          {saving ? "Saving…" : "Save providers"}
        </button>
        {message && <span className="settings-action-note">{message}</span>}
      </div>
    </div>
  );
}

function DefaultProviderPicker(props: {
  names: ProviderName[];
  value: ProviderName | "";
  onChange: (name: ProviderName) => void;
}): ReactNode {
  return (
    <div className="settings-default-provider">
      <div className="settings-field-label">Default provider</div>
      {props.names.length === 0 ? (
        <span className="settings-hint">
          At least one provider must be configured.
        </span>
      ) : (
        props.names.map((name) => (
          <label key={name} className="settings-radio">
            <input
              type="radio"
              checked={props.value === name}
              onChange={() => props.onChange(name)}
            />
            {PROVIDER_BY_NAME.get(name)?.label ?? name}
          </label>
        ))
      )}
    </div>
  );
}

function hydrateProviders(
  providers: Awaited<ReturnType<typeof getSettingsProviders>>["providers"],
): Record<string, ProviderForm> {
  const next: Record<string, ProviderForm> = {};
  for (const provider of providers) {
    const meta = PROVIDER_BY_NAME.get(provider.name as ProviderName);
    if (!meta) continue;
    next[meta.name] = {
      name: meta.name,
      apiKey: "",
      apiKeySet: provider.api_key_set,
      host: provider.host || meta.defaultHost,
      baseUrl: provider.base_url || "",
      chatModel: provider.chat_model || meta.defaultChat,
      embedModel: meta.supportsEmbed
        ? provider.embed_model || meta.defaultEmbed
        : "",
    };
  }
  return next;
}
