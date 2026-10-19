import { useEffect, useRef, useState } from "react";
import { getAgentModels, putSystemAgentModels } from "@/api/agentModels";
import { getRecommendations } from "@/api/hardware";
import { listModels } from "@/api/providers";
import type {
  AgentModelOverrideInput,
  AgentModelRecommendation,
  AgentModelsResponse,
} from "@/api/types";
import type { StatusTone } from "../kit/StatusLine";
import { PROVIDER_BY_NAME, type ProviderName } from "../providerModels";
import { describeApiError } from "@/api/client";

export interface RowValue {
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

/** Built-in agents' provider/model overrides, recommendations and saving. */
export function useAgentModels() {
  const [data, setData] = useState<AgentModelsResponse | null>(null);
  const [rows, setRows] = useState<Rows>({});
  // The last hydrated rows; `dirty` compares the edited rows against these.
  const [saved, setSaved] = useState<Rows>({});
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{
    text: string;
    tone: StatusTone;
  } | null>(null);
  const [recommendations, setRecommendations] = useState<
    Record<string, AgentModelRecommendation>
  >({});
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

  const hydrate = (res: AgentModelsResponse) => {
    setData(res);
    const hydrated = toRows(res);
    setSaved(hydrated);
    setRows(hydrated);
  };

  useEffect(() => {
    let cancelled = false;
    void getAgentModels()
      .then((res) => {
        if (cancelled) return;
        hydrate(res);
        for (const agent of res.agents.filter((entry) => entry.system)) {
          ensureModels(agent.provider);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setStatus({
            text: describeApiError(err, "Loading agents failed"),
            tone: "error",
          });
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
    const before = saved[id];
    return (
      row.provider !== (before?.provider ?? "") ||
      row.chat_model !== (before?.chat_model ?? "")
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
      hydrate(await putSystemAgentModels(overrides));
      setStatus({ text: "Saved. Agents rebound immediately.", tone: "ok" });
    } catch (err) {
      setStatus({
        text: describeApiError(err, "Saving overrides failed"),
        tone: "error",
      });
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
    setStatus({
      text: "Recommendation staged. Save to rebind the agent.",
      tone: "muted",
    });
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
    setStatus({
      text: "Recommended built-in setup staged. Save to apply it.",
      tone: "muted",
    });
  };

  const systemAgents = data?.agents.filter((agent) => agent.system) ?? [];
  const hasRecommendations = systemAgents.some(
    (agent) => agent.uses_model && Boolean(recommendations[agent.id]?.model),
  );

  return {
    data,
    rows,
    saving,
    status,
    recommendations,
    dirty,
    systemAgents,
    hasRecommendations,
    patchRow,
    ensureModels,
    modelOptions,
    stageRecommendation,
    applyRecommendedSetup,
    save,
  };
}
