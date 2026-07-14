import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { useApp } from "../../context/app-ctx";
import { ConfirmModal } from "../../components/ConfirmModal";
import { AddAgentModal } from "./AddAgentModal";
import { AgentCard } from "./AgentCard";
import { AgentDetailModal } from "./AgentDetailModal";
import { ResearcherWorkspace } from "./ResearcherWorkspace";
import { StandupWorkspace } from "./StandupWorkspace";
import { RecentActivity } from "./RecentActivity";
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
  const [detailId, setDetailId] = useState<string | null>(null);
  const [researcherOpen, setResearcherOpen] = useState(false);
  const [standupOpen, setStandupOpen] = useState(false);
  // Accessible confirm dialog (replaces window.confirm) for deleting an agent.
  const [confirmDelete, setConfirmDelete] = useState<Agent | null>(null);

  // All run/activity lookups key on the registry id, never the display name:
  // a custom agent named "My Agent" has id "my-agent", and the backend (run
  // endpoint, activity map, changelog) knows it only by that id.
  const handleRun = async (a: Agent) => {
    if (runningAgents.has(a.id)) return;
    setRunningAgents((prev) => new Set(prev).add(a.id));
    try {
      const res = await runAgent(a.id);
      pushToast({
        icon: "▶",
        agent: a.id,
        body: formatRunResult(a.id, res.result),
      });
    } catch (err) {
      pushToast({
        icon: "⚠",
        agent: "sentinel",
        body: `${a.name} run failed: ${err instanceof Error ? err.message : "unknown error"}`,
      });
    } finally {
      setRunningAgents((prev) => {
        const next = new Set(prev);
        next.delete(a.id);
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
    pushToast({
      icon: "🗑",
      agent: "archivist",
      body: `Deleted agent ${a.name}`,
    });
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

  const isRunnable = (a: Agent) =>
    RUNNABLE_LOOM_AGENTS.has(a.id) || customIds.has(a.id);

  const card = (a: Agent) => (
    <AgentCard
      key={a.id}
      agent={a}
      live={agentActivity[a.id]}
      lastEvent={lastEventByAgent.get(a.id)}
      isCustom={customIds.has(a.id)}
      runnable={isRunnable(a)}
      running={runningAgents.has(a.id)}
      onRun={() => void handleRun(a)}
      onEdit={() => void handleEdit(a)}
      onDelete={() => setConfirmDelete(a)}
      onWorkspace={
        a.id === "researcher" && !customIds.has(a.id)
          ? () => setResearcherOpen(true)
          : a.id === "standup" && !customIds.has(a.id)
            ? () => setStandupOpen(true)
          : undefined
      }
      workspaceLabel={a.id === "standup" ? "open" : "ask"}
      onOpen={() => setDetailId(a.id)}
    />
  );

  const detailAgent = detailId
    ? (merged.find((a) => a.id === detailId) ?? null)
    : null;

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
      <RecentActivity changelog={changelog} />

      {detailAgent && (
        <AgentDetailModal
          agent={detailAgent}
          live={agentActivity[detailAgent.id]}
          isCustom={customIds.has(detailAgent.id)}
          runnable={isRunnable(detailAgent)}
          running={runningAgents.has(detailAgent.id)}
          onRun={() => void handleRun(detailAgent)}
          onEdit={() => {
            setDetailId(null);
            void handleEdit(detailAgent);
          }}
          onDelete={() => {
            setDetailId(null);
            setConfirmDelete(detailAgent);
          }}
          onClose={() => setDetailId(null)}
        />
      )}
      {researcherOpen && (
        <ResearcherWorkspace onClose={() => setResearcherOpen(false)} />
      )}
      {standupOpen && (
        <StandupWorkspace onClose={() => setStandupOpen(false)} />
      )}
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
