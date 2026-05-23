import { useState } from "react";
import type { ReactNode } from "react";
import { testProvider } from "../../api/providers";
import type {
  OnboardingProviderPayload,
  TestProviderResponse,
} from "../../api/types";

interface Props {
  provider: OnboardingProviderPayload | null;
  onChange: (provider: OnboardingProviderPayload | null) => void;
  onSubmit: () => void;
  onBack: () => void;
  submitting: boolean;
  submitError: string | null;
}

interface ProviderOption {
  name: "openai" | "anthropic" | "xai" | "openrouter" | "ollama";
  label: string;
  requiresApiKey: boolean;
  requiresHost: boolean;
  hint: string;
  defaultChat?: string;
  defaultEmbed?: string;
  defaultHost?: string;
}

const PROVIDERS: ProviderOption[] = [
  {
    name: "openai",
    label: "OpenAI",
    requiresApiKey: true,
    requiresHost: false,
    hint: "Get a key at platform.openai.com/api-keys.",
    defaultChat: "gpt-4o-mini",
    defaultEmbed: "text-embedding-3-small",
  },
  {
    name: "anthropic",
    label: "Anthropic",
    requiresApiKey: true,
    requiresHost: false,
    hint: "console.anthropic.com → settings → API keys.",
    defaultChat: "claude-sonnet-4-6-20251001",
  },
  {
    name: "xai",
    label: "xAI",
    requiresApiKey: true,
    requiresHost: false,
    hint: "console.x.ai for keys.",
    defaultChat: "grok-2-latest",
  },
  {
    name: "openrouter",
    label: "OpenRouter",
    requiresApiKey: true,
    requiresHost: false,
    hint: "openrouter.ai/keys — one key, every model.",
    defaultChat: "openai/gpt-4o-mini",
  },
  {
    name: "ollama",
    label: "Ollama (local)",
    requiresApiKey: false,
    requiresHost: true,
    hint: "Runs locally. Pull a model with `ollama pull llama3`.",
    defaultChat: "llama3",
    defaultEmbed: "nomic-embed-text",
    defaultHost: "http://localhost:11434",
  },
];

export function ProviderConfig({
  provider,
  onChange,
  onSubmit,
  onBack,
  submitting,
  submitError,
}: Props): ReactNode {
  const [testResult, setTestResult] = useState<TestProviderResponse | null>(
    null,
  );
  const [testing, setTesting] = useState(false);

  const selectedName = provider?.name as ProviderOption["name"] | undefined;
  const selectedMeta = PROVIDERS.find((p) => p.name === selectedName);

  const pickProvider = (option: ProviderOption) => {
    setTestResult(null);
    onChange({
      name: option.name,
      api_key: provider?.name === option.name ? provider.api_key ?? "" : "",
      chat_model:
        provider?.name === option.name
          ? provider.chat_model ?? option.defaultChat ?? ""
          : option.defaultChat ?? "",
      embed_model:
        provider?.name === option.name
          ? provider.embed_model ?? option.defaultEmbed ?? ""
          : option.defaultEmbed ?? "",
      host:
        provider?.name === option.name
          ? provider.host ?? option.defaultHost ?? ""
          : option.defaultHost ?? "",
    });
  };

  const patch = (next: Partial<OnboardingProviderPayload>) => {
    if (!provider) return;
    onChange({ ...provider, ...next });
    setTestResult(null);
  };

  const runTest = async () => {
    if (!provider) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testProvider(provider.name, {
        api_key: provider.api_key ?? "",
        host: provider.host ?? "",
      });
      setTestResult(result);
    } catch (err) {
      setTestResult({
        ok: false,
        latency_ms: 0,
        error: err instanceof Error ? err.message : "Test failed",
      });
    } finally {
      setTesting(false);
    }
  };

  const skip = () => {
    onChange(null);
    onSubmit();
  };

  const finish = () => {
    onSubmit();
  };

  return (
    <div className="onb-step">
      <h2 className="onb-h2">Hook up an AI provider</h2>
      <p className="onb-sub">
        Loom's agents need a model to call. You can skip this step and add one
        later from Settings.
      </p>

      <div className="onb-providers" role="radiogroup" aria-label="Provider">
        {PROVIDERS.map((opt) => {
          const active = selectedName === opt.name;
          return (
            <button
              key={opt.name}
              type="button"
              role="radio"
              aria-checked={active}
              className={`onb-provider-card ${active ? "active" : ""}`}
              onClick={() => pickProvider(opt)}
            >
              <div className="onb-provider-name">{opt.label}</div>
              <div className="onb-provider-hint">{opt.hint}</div>
            </button>
          );
        })}
      </div>

      {selectedMeta && provider && (
        <div className="onb-provider-form">
          {selectedMeta.requiresApiKey && (
            <label className="onb-field">
              <span className="onb-field-label">API key</span>
              <input
                className="input mono"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={provider.api_key ?? ""}
                onChange={(e) => patch({ api_key: e.target.value })}
                placeholder="sk-…"
              />
            </label>
          )}
          {selectedMeta.requiresHost && (
            <label className="onb-field">
              <span className="onb-field-label">Host</span>
              <input
                className="input mono"
                type="text"
                value={provider.host ?? ""}
                onChange={(e) => patch({ host: e.target.value })}
                placeholder={selectedMeta.defaultHost}
              />
            </label>
          )}
          <div className="onb-field-row">
            <label className="onb-field">
              <span className="onb-field-label">Chat model</span>
              <input
                className="input mono"
                type="text"
                value={provider.chat_model ?? ""}
                onChange={(e) => patch({ chat_model: e.target.value })}
                placeholder={selectedMeta.defaultChat ?? ""}
              />
            </label>
            <label className="onb-field">
              <span className="onb-field-label">Embed model</span>
              <input
                className="input mono"
                type="text"
                value={provider.embed_model ?? ""}
                onChange={(e) => patch({ embed_model: e.target.value })}
                placeholder={selectedMeta.defaultEmbed ?? "—"}
              />
            </label>
          </div>
          <div className="onb-test">
            <button
              className="btn btn-md"
              type="button"
              onClick={runTest}
              disabled={testing}
            >
              {testing ? "Testing…" : "Test connection"}
            </button>
            {testResult && (
              <span
                className={`onb-test-result ${
                  testResult.ok ? "onb-test-ok" : "onb-test-fail"
                }`}
              >
                {testResult.ok
                  ? `OK — ${testResult.latency_ms}ms`
                  : `Failed — ${testResult.error ?? "unknown"}`}
              </span>
            )}
          </div>
          <div className="onb-help">
            A failed test doesn't block you. Save anyway and we'll surface the
            error in the main UI.
          </div>
        </div>
      )}

      {submitError && <div className="onb-submit-error">{submitError}</div>}

      <div className="onb-actions">
        <button className="btn btn-md" onClick={onBack} disabled={submitting}>
          ← Back
        </button>
        <button
          className="btn btn-md"
          type="button"
          onClick={skip}
          disabled={submitting}
        >
          Skip for now
        </button>
        <button
          className="btn btn-md btn-active"
          onClick={finish}
          disabled={submitting || !provider}
        >
          {submitting ? "Saving…" : "Finish →"}
        </button>
      </div>
    </div>
  );
}
