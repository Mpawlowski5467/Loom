import { useState } from "react";
import type { ReactNode } from "react";
import { testProvider } from "../../api/providers";
import type {
  OnboardingProviderPayload,
  TestProviderResponse,
} from "../../api/types";

interface DraftPatch {
  providers?: OnboardingProviderPayload[];
  chatProvider?: string | null;
  embedProvider?: string | null;
}

interface Props {
  providers: OnboardingProviderPayload[];
  chatProvider: string | null;
  embedProvider: string | null;
  onChange: (patch: DraftPatch) => void;
  onSubmit: () => void;
  onBack: () => void;
  submitting: boolean;
  submitError: string | null;
}

type ProviderName =
  | "openai"
  | "anthropic"
  | "xai"
  | "openrouter"
  | "ollama";

interface ProviderOption {
  name: ProviderName;
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

const META_BY_NAME = new Map(PROVIDERS.map((p) => [p.name, p]));

function defaultPayload(opt: ProviderOption): OnboardingProviderPayload {
  return {
    name: opt.name,
    api_key: "",
    chat_model: opt.defaultChat ?? "",
    embed_model: opt.defaultEmbed ?? "",
    host: opt.defaultHost ?? "",
  };
}

export function ProviderConfig({
  providers,
  chatProvider,
  embedProvider,
  onChange,
  onSubmit,
  onBack,
  submitting,
  submitError,
}: Props): ReactNode {
  const [testResults, setTestResults] = useState<
    Record<string, TestProviderResponse | null>
  >({});
  const [testing, setTesting] = useState<string | null>(null);

  const togglePicked = (opt: ProviderOption) => {
    const exists = providers.find((p) => p.name === opt.name);
    if (exists) {
      const next = providers.filter((p) => p.name !== opt.name);
      const patch: DraftPatch = { providers: next };
      if (chatProvider === opt.name)
        patch.chatProvider = next[0]?.name ?? null;
      if (embedProvider === opt.name)
        patch.embedProvider =
          next.find((p) =>
            META_BY_NAME.get(p.name as ProviderName)?.defaultEmbed,
          )?.name ??
          next[0]?.name ??
          null;
      onChange(patch);
    } else {
      const next = [...providers, defaultPayload(opt)];
      const patch: DraftPatch = { providers: next };
      if (!chatProvider) patch.chatProvider = opt.name;
      if (!embedProvider && opt.defaultEmbed) patch.embedProvider = opt.name;
      onChange(patch);
    }
    setTestResults((prev) => ({ ...prev, [opt.name]: null }));
  };

  const patchProvider = (
    name: string,
    update: Partial<OnboardingProviderPayload>,
  ) => {
    onChange({
      providers: providers.map((p) =>
        p.name === name ? { ...p, ...update } : p,
      ),
    });
    setTestResults((prev) => ({ ...prev, [name]: null }));
  };

  const runTest = async (prov: OnboardingProviderPayload) => {
    setTesting(prov.name);
    try {
      const result = await testProvider(prov.name, {
        api_key: prov.api_key ?? "",
        host: prov.host ?? "",
      });
      setTestResults((prev) => ({ ...prev, [prov.name]: result }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [prov.name]: {
          ok: false,
          latency_ms: 0,
          error: err instanceof Error ? err.message : "Test failed",
        },
      }));
    } finally {
      setTesting(null);
    }
  };

  const skip = () => {
    const ok = window.confirm(
      "Skip provider setup? Agents, search, and graph linking stay offline " +
        "until you add a provider in Settings → Providers.",
    );
    if (!ok) return;
    onChange({ providers: [], chatProvider: null, embedProvider: null });
    onSubmit();
  };

  const tested = (name: string | null): boolean =>
    !!name && testResults[name]?.ok === true;
  // Finish requires the chosen chat + embed providers to have a passing
  // connection test, so you can't land in an app where every agent silently
  // fails on an empty or bad key. The Skip button is the explicit escape.
  const canFinish =
    providers.length > 0 &&
    !!chatProvider &&
    !!embedProvider &&
    tested(chatProvider) &&
    tested(embedProvider);
  const finishHint =
    providers.length > 0 && !canFinish
      ? "Test your chat and embed providers to finish — or Skip for now."
      : null;

  return (
    <div className="onb-step">
      <h2 className="onb-h2">Hook up AI providers</h2>
      <p className="onb-sub">
        You can configure more than one. Pick the default for chat and the
        default for embeddings — they can be different providers.
      </p>

      <div className="onb-providers" role="group" aria-label="Provider">
        {PROVIDERS.map((opt) => {
          const active = providers.some((p) => p.name === opt.name);
          return (
            <button
              key={opt.name}
              type="button"
              aria-pressed={active}
              className={`onb-provider-card ${active ? "active" : ""}`}
              onClick={() => togglePicked(opt)}
            >
              <div className="onb-provider-name">{opt.label}</div>
              <div className="onb-provider-hint">{opt.hint}</div>
            </button>
          );
        })}
      </div>

      {providers.length === 0 && (
        <div className="onb-providers-empty">
          <p>
            Pick at least one provider above to unlock agents, search, and graph
            linking.
          </p>
          <p className="onb-providers-empty-sub">
            <strong>Chat</strong> powers the agents and Council; <strong>embed</strong>{" "}
            powers semantic search and link suggestions. They can be different
            providers — or Skip to stay fully local for now.
          </p>
        </div>
      )}

      {providers.map((prov) => {
        const meta = META_BY_NAME.get(prov.name as ProviderName);
        if (!meta) return null;
        const result = testResults[prov.name] ?? null;
        return (
          <div key={prov.name} className="onb-provider-form">
            <div className="onb-provider-form-h">{meta.label}</div>
            {meta.requiresApiKey && (
              <label className="onb-field">
                <span className="onb-field-label">API key</span>
                <input
                  className="input mono"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={prov.api_key ?? ""}
                  onChange={(e) =>
                    patchProvider(prov.name, { api_key: e.target.value })
                  }
                  placeholder="sk-…"
                />
              </label>
            )}
            {meta.requiresHost && (
              <label className="onb-field">
                <span className="onb-field-label">Host</span>
                <input
                  className="input mono"
                  type="text"
                  value={prov.host ?? ""}
                  onChange={(e) =>
                    patchProvider(prov.name, { host: e.target.value })
                  }
                  placeholder={meta.defaultHost}
                />
              </label>
            )}
            <div className="onb-field-row">
              <label className="onb-field">
                <span className="onb-field-label">Chat model</span>
                <input
                  className="input mono"
                  type="text"
                  value={prov.chat_model ?? ""}
                  onChange={(e) =>
                    patchProvider(prov.name, { chat_model: e.target.value })
                  }
                  placeholder={meta.defaultChat ?? ""}
                />
              </label>
              <label className="onb-field">
                <span className="onb-field-label">Embed model</span>
                <input
                  className="input mono"
                  type="text"
                  value={prov.embed_model ?? ""}
                  onChange={(e) =>
                    patchProvider(prov.name, { embed_model: e.target.value })
                  }
                  placeholder={meta.defaultEmbed ?? "—"}
                />
              </label>
            </div>
            <div className="onb-test">
              <button
                className="btn btn-md"
                type="button"
                onClick={() => void runTest(prov)}
                disabled={testing === prov.name}
              >
                {testing === prov.name ? "Testing…" : "Test connection"}
              </button>
              {result && (
                <span
                  className={`onb-test-result ${
                    result.ok ? "onb-test-ok" : "onb-test-fail"
                  }`}
                >
                  {result.ok
                    ? `OK — ${result.latency_ms}ms`
                    : `Failed — ${result.error ?? "unknown"}`}
                </span>
              )}
            </div>
          </div>
        );
      })}

      {providers.length > 0 && (
        <div className="onb-defaults">
          <div className="onb-defaults-h">Defaults</div>
          <div className="onb-field-row">
            <label className="onb-field">
              <span className="onb-field-label">Chat provider</span>
              <select
                className="input mono"
                value={chatProvider ?? ""}
                onChange={(e) =>
                  onChange({ chatProvider: e.target.value || null })
                }
              >
                {providers.map((p) => (
                  <option key={p.name} value={p.name}>
                    {META_BY_NAME.get(p.name as ProviderName)?.label ?? p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="onb-field">
              <span className="onb-field-label">Embed provider</span>
              <select
                className="input mono"
                value={embedProvider ?? ""}
                onChange={(e) =>
                  onChange({ embedProvider: e.target.value || null })
                }
              >
                {providers.map((p) => (
                  <option key={p.name} value={p.name}>
                    {META_BY_NAME.get(p.name as ProviderName)?.label ?? p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}

      {submitError && <div className="onb-submit-error">{submitError}</div>}
      {finishHint && <div className="onb-finish-hint">{finishHint}</div>}

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
          onClick={onSubmit}
          disabled={submitting || !canFinish}
        >
          {submitting ? "Saving…" : "Finish →"}
        </button>
      </div>
    </div>
  );
}
