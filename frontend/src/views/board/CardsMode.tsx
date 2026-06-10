import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { useApp } from "../../context/app-ctx";
import { ConfirmModal } from "../../components/ConfirmModal";
import { AddAgentModal } from "./AddAgentModal";
import { AgentCard } from "./AgentCard";
import { formatRelativeTime, renderTarget } from "./boardHelpers";
import {
  deleteCustomAgent,
  getAgentRegistry,
  type AgentRegistryRecord,
} from "../../api/agentsRegistry";
import {
  RUNNABLE_LOOM_AGENTS,
  formatRunResult,
  runAgent,
} from "../../api/agents";
import type { Agent } from "../../data/types";

export function CardsMode(): ReactNode {
  const {
    agents,
    agentActivity,
    changelog,
    customAgents,
    refreshCustomAgents,
    pushToast,
  } = useApp();
  const customIds = new Set(customAgents.map((a) => a.id));
  const merged: Agent[] = [
    ...agents.filter((a) => !customIds.has(a.id)),
    ...customAgents,
  ];
  const loom = merged.filter((a) => a.layer === "loom");
  const shuttle = merged.filter((a) => a.layer === "shuttle");

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AgentRegistryRecord | null>(null);
  const [runningAgents, setRunningAgents] = useState<Set<string>>(new Set());
  // Accessible confirm dialog (replaces window.confirm) for deleting an agent.
  const [confirmDelete, setConfirmDelete] = useState<Agent | null>(null);

  const handleRun = async (a: Agent) => {
    const key = a.name.toLowerCase();
    if (runningAgents.has(key)) return;
    setRunningAgents((prev) => new Set(prev).add(key));
    try {
      const res = await runAgent(key);
      pushToast({ icon: "▶", agent: key, body: formatRunResult(key, res.result) });
    } catch (err) {
      pushToast({
        icon: "⚠",
        agent: "sentinel",
        body: `${a.name} run failed: ${err instanceof Error ? err.message : "unknown error"}`,
      });
    } finally {
      setRunningAgents((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const handleEdit = async (a: Agent) => {
    try {
      setEditing(await getAgentRegistry(a.id));
    } catch (err) {
      pushToast({
        icon: "⚠",
        agent: "sentinel",
        body: `Failed to load ${a.name}: ${err instanceof Error ? err.message : "unknown error"}`,
      });
    }
  };

  // Deletion runs after the user confirms in the modal. Errors propagate so the
  // ConfirmModal shows them inline and stays open for a retry.
  const deleteNow = async (a: Agent) => {
    await deleteCustomAgent(a.id);
    await refreshCustomAgents();
    pushToast({ icon: "🗑", agent: "archivist", body: `Deleted agent ${a.name}` });
  };

  // Per-agent last event: changelog is sorted newest-first, so the first hit
  // per agent is its most recent activity.
  const lastEventByAgent = useMemo(() => {
    const map = new Map<string, (typeof changelog)[number]>();
    for (const ev of changelog) {
      if (!map.has(ev.agent)) map.set(ev.agent, ev);
    }
    return map;
  }, [changelog]);

  const card = (a: Agent) => {
    const key = a.name.toLowerCase();
    return (
      <AgentCard
        key={a.id}
        agent={a}
        live={agentActivity[key]}
        lastEvent={lastEventByAgent.get(key)}
        isCustom={customIds.has(a.id)}
        runnable={RUNNABLE_LOOM_AGENTS.has(key)}
        running={runningAgents.has(key)}
        onRun={() => void handleRun(a)}
        onEdit={() => void handleEdit(a)}
        onDelete={() => setConfirmDelete(a)}
      />
    );
  };

  return (
    <div>
      <div className="section-divider">Loom Layer · vault hygiene</div>
      <div className="agents-grid">{loom.map(card)}</div>

      <div className="section-divider">Shuttle Layer · outbound</div>
      <div className="agents-grid">
        {shuttle.map(card)}
        <button
          type="button"
          className="agent-card agent-card--add"
          onClick={() => setAdding(true)}
        >
          <Plus size={18} aria-hidden="true" />
          <span>Add agent</span>
        </button>
      </div>

      <div className="section-divider">Recent activity</div>
      <div className="changelog">
        {changelog.length === 0 && (
          <div className="changelog-empty">
            No agent activity yet. Process a capture or send a council message.
          </div>
        )}
        {changelog.slice(0, 15).map((ev) => (
          <div key={ev.id} className="changelog-row" title={ev.ts}>
            <span className="changelog-ts">{formatRelativeTime(ev.ts)}</span>
            <span className="changelog-agent">{ev.agent}</span>
            <span>
              {ev.action} {renderTarget(ev.target)}
            </span>
            <span className={`changelog-verdict ${ev.sentinel}`}>
              {ev.sentinel === "ok" ? "✓" : ev.sentinel === "warn" ? "⚠" : "✕"}
            </span>
          </div>
        ))}
      </div>

      {adding && (
        <AddAgentModal
          onClose={() => setAdding(false)}
          onSaved={async () => {
            await refreshCustomAgents();
            setAdding(false);
          }}
        />
      )}
      {editing && (
        <AddAgentModal
          existing={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await refreshCustomAgents();
            setEditing(null);
          }}
        />
      )}
      {confirmDelete && (
        <ConfirmModal
          title={`Delete custom agent "${confirmDelete.name}"?`}
          body="This removes the agent and its registry entry. This can't be undone."
          confirmLabel="Delete"
          destructive
          onConfirm={() => deleteNow(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
