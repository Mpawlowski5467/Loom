import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Lock, Save, Sparkles } from "lucide-react";
import { getAgentModels, putSystemAgentModels } from "../../api/agentModels";
import { getRecommendations } from "../../api/hardware";
import { listModels } from "../../api/providers";
import type {
  AgentModelOverrideInput,
  AgentModelRecommendation,
  AgentModelsResponse,
} from "../../api/types";
import { ModelCombobox } from "./ModelCombobox";
import {
  PROVIDERS,
  PROVIDER_BY_NAME,
  type ProviderName,
} from "./providerModels";

interface RowValue {
  provider: string;
  chat_model: string;
}

type Rows = Record<string, RowValue>;

function toRows(data: AgentModelsResponse): Rows {
  const rows: Rows = {};
  for (const agent of data.agents.filter((entry) => entry.system)) {
    rows[agent.id] = agent.uses_model
      ? { provider: agent.provider, chat_model: agent.chat_model }
      : { provider: "", chat_model: "" };
  }
  return rows;
}

/** Per-agent chat provider/model overrides; saving rebinds agents immediately. */
export function AgentModelsCard(): ReactNode {
  const [data, setData] = useState<AgentModelsResponse | null>(null);
  const [rows, setRows] = useState<Rows>({});
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<
    Record<string, AgentModelRecommendation>
  >({});
  const savedRef = useRef<Rows>({});
  // Live chat-model ids per provider, fetched once each (static list as merge base).
  const [liveModels, setLiveModels] = useState<Record<string, string[]>>({});
  const fetchedRef = useRef(new Set<string>());

  const ensureModels = (provider: string) => {
    if (!provider || fetchedRef.current.has(provider)) return;
    fetchedRef.current.add(provider);
    void listModels(provider)
      .then((res) => {
        setLiveModels((prev) => ({
          ...prev,
          [provider]: res.chat.map((m) => m.id),
        }));
      })
      .catch(() => {
        // Static catalog suggestions still apply; free text always works.
      });
  };

  useEffect(() => {
    let cancelled = false;
    void getAgentModels()
      .then((res) => {
        if (cancelled) return;
        setData(res);
        const hydrated = toRows(res);
        savedRef.current = hydrated;
        setRows(hydrated);
        for (const agent of res.agents.filter((entry) => entry.system)) {
          ensureModels(agent.provider);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setStatus(
            err instanceof Error ? err.message : "Loading agents failed",
          );
        }
      });
    void getRecommendations()
      .then((res) => {
        if (cancelled) return;
        setRecommendations(
          Object.fromEntries(res.agents.map((item) => [item.agent_id, item])),
        );
      })
      .catch(() => {
        // Manual built-in overrides still work when hardware/Ollama is absent.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const patchRow = (id: string, patch: Partial<RowValue>) => {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id]!, ...patch } }));
  };

  const dirty = Object.entries(rows).some(([id, row]) => {
    const saved = savedRef.current[id];
    return (
      row.provider !== (saved?.provider ?? "") ||
      row.chat_model !== (saved?.chat_model ?? "")
    );
  });

  const save = async () => {
    setSaving(true);
    setStatus(null);
    const overrides: Record<string, AgentModelOverrideInput> = {};
    for (const [id, row] of Object.entries(rows)) {
      if (!row.provider && !row.chat_model) continue;
      overrides[id] = { provider: row.provider, chat_model: row.chat_model };
    }
    try {
      const res = await putSystemAgentModels(overrides);
      setData(res);
      const hydrated = toRows(res);
      savedRef.current = hydrated;
      setRows(hydrated);
      setStatus("Saved. Agents rebound immediately.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Saving overrides failed");
    } finally {
      setSaving(false);
    }
  };

  const modelOptions = (provider: string): string[] => {
    const staticChat =
      PROVIDER_BY_NAME.get(provider as ProviderName)?.chatModels ?? [];
    return Array.from(
      new Set([...(liveModels[provider] ?? []), ...staticChat]),
    );
  };

  const stageRecommendation = (agentId: string) => {
    const recommendation = recommendations[agentId];
    if (!recommendation?.model) return;
    patchRow(agentId, {
      provider: recommendation.provider,
      chat_model: recommendation.model,
    });
    ensureModels(recommendation.provider);
    setStatus("Recommendation staged. Save to rebind the agent.");
  };

  const applyRecommendedSetup = () => {
    setRows((prev) => {
      const next = { ...prev };
      for (const agent of data?.agents ?? []) {
        if (!agent.system || !agent.uses_model) continue;
        const recommendation = recommendations[agent.id];
        if (!recommendation?.model) continue;
        next[agent.id] = {
          provider: recommendation.provider,
          chat_model: recommendation.model,
        };
      }
      return next;
    });
    ensureModels("ollama");
    setStatus("Recommended built-in setup staged. Save to apply it.");
  };

  const systemAgents = data?.agents.filter((agent) => agent.system) ?? [];
  const hasRecommendations = systemAgents.some(
    (agent) => agent.uses_model && Boolean(recommendations[agent.id]?.model),
  );

  return (
    <section>
      <h2 className="settings-subhead">Built-in agent models</h2>
      <p className="settings-copy settings-copy-tight">
        Use hardware-aware local recommendations or set a manual override. Empty
        rows use the global default
        {data ? ` (${data.default_provider})` : ""}. Custom agents keep their
        model choice in Add/Edit Agent.
      </p>
      {data && (
        <ul className="settings-agent-list">
          {systemAgents.map((agent) => {
            const row = rows[agent.id] ?? { provider: "", chat_model: "" };
            const recommendation = recommendations[agent.id];
            return (
              <li key={agent.id} className="settings-agent-row">
                <div className="settings-agent-ident">
                  <span aria-hidden="true">{agent.icon}</span>
                  <strong>{agent.name}</strong>
                  <Lock size={12} aria-label="System agent" />
                  <span className="settings-agent-role">{agent.role}</span>
                </div>
                {agent.uses_model ? (
                  <>
                    <label className="settings-field">
                      <span className="settings-field-label">Provider</span>
                      <select
                        className="input mono"
                        aria-label={`${agent.name} provider`}
                        value={row.provider}
                        onChange={(e) => {
                          const provider = e.target.value;
                          patchRow(agent.id, { provider });
                          ensureModels(provider);
                        }}
                      >
                        <option value="">Default</option>
                        {PROVIDERS.map((p) => (
                          <option key={p.name} value={p.name}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <ModelCombobox
                      label="Model"
                      value={row.chat_model}
                      options={modelOptions(row.provider)}
                      disabled={!row.provider}
                      onChange={(value) =>
                        patchRow(agent.id, { chat_model: value })
                      }
                    />
                  </>
                ) : (
                  <div className="settings-agent-no-model">
                    Deterministic checks · no model required
                  </div>
                )}
                <div className="settings-agent-recommendation">
                  {recommendation?.model ? (
                    <>
                      <span>
                        Recommended: <strong>{recommendation.model}</strong>
                      </span>
                      {recommendation.rating && (
                        <span
                          className={`settings-rating-chip ${recommendation.rating}`}
                        >
                          {recommendation.rating}
                        </span>
                      )}
                      <span className="settings-model-badge">
                        {recommendation.source} · {recommendation.confidence}
                      </span>
                      <span className="settings-hint">
                        {recommendation.reason}
                      </span>
                      <button
                        className="btn btn-md"
                        type="button"
                        onClick={() => stageRecommendation(agent.id)}
                      >
                        Use recommended
                      </button>
                    </>
                  ) : (
                    <span className="settings-hint">
                      {recommendation?.reason ??
                        "No compatible installed Ollama recommendation."}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {!data && !status && <p className="settings-hint">Loading agents…</p>}
      <div className="settings-actions">
        <button
          className="btn btn-md"
          type="button"
          disabled={!data || !hasRecommendations || saving}
          onClick={applyRecommendedSetup}
        >
          <Sparkles size={14} aria-hidden="true" />
          Apply recommended setup
        </button>
        <button
          className="btn btn-md btn-active"
          type="button"
          disabled={!data || !dirty || saving}
          onClick={() => void save()}
        >
          <Save size={14} aria-hidden="true" />
          {saving ? "Saving…" : "Save agent models"}
        </button>
      </div>
      {status && <div className="settings-inline-status">{status}</div>}
    </section>
  );
}
