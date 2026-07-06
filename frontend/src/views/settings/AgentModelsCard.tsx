import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Lock, Save } from "lucide-react";
import { getAgentModels, putAgentModels } from "../../api/agentModels";
import { listModels } from "../../api/providers";
import type { AgentModelOverrideInput, AgentModelsResponse } from "../../api/types";
import { ModelCombobox } from "./ModelCombobox";
import { PROVIDERS, PROVIDER_BY_NAME, type ProviderName } from "./providerModels";

interface RowValue {
  provider: string;
  chat_model: string;
}

type Rows = Record<string, RowValue>;

function toRows(data: AgentModelsResponse): Rows {
  const rows: Rows = {};
  for (const agent of data.agents) {
    rows[agent.id] = { provider: agent.provider, chat_model: agent.chat_model };
  }
  return rows;
}

/** Per-agent chat provider/model overrides; saving rebinds agents immediately. */
export function AgentModelsCard(): ReactNode {
  const [data, setData] = useState<AgentModelsResponse | null>(null);
  const [rows, setRows] = useState<Rows>({});
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
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
        for (const agent of res.agents) ensureModels(agent.provider);
      })
      .catch((err) => {
        if (!cancelled) {
          setStatus(err instanceof Error ? err.message : "Loading agents failed");
        }
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
      const res = await putAgentModels(overrides);
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
    return Array.from(new Set([...(liveModels[provider] ?? []), ...staticChat]));
  };

  return (
    <section>
      <h2 className="settings-subhead">Agent models</h2>
      <p className="settings-copy settings-copy-tight">
        Give any agent its own chat provider and model. Empty rows use the
        global default{data ? ` (${data.default_provider})` : ""}.
      </p>
      {data && (
        <ul className="settings-agent-list">
          {data.agents.map((agent) => {
            const row = rows[agent.id] ?? { provider: "", chat_model: "" };
            return (
              <li key={agent.id} className="settings-agent-row">
                <div className="settings-agent-ident">
                  <span aria-hidden="true">{agent.icon}</span>
                  <strong>{agent.name}</strong>
                  {agent.system && (
                    <Lock size={12} aria-label="System agent" />
                  )}
                </div>
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
                  onChange={(value) => patchRow(agent.id, { chat_model: value })}
                />
              </li>
            );
          })}
        </ul>
      )}
      {!data && !status && <p className="settings-hint">Loading agents…</p>}
      <div className="settings-actions">
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
