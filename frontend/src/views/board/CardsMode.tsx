import { useState } from "react";
import type { ReactNode } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useApp } from "../../context/app-ctx";
import { StatusBadge } from "../../components/primitives/StatusBadge";
import { AgentBlob } from "../../components/primitives/AgentBlob";
import { AddAgentModal } from "./AddAgentModal";
import {
  deleteCustomAgent,
  type AgentRegistryRecord,
} from "../../api/agentsRegistry";
import type { Agent } from "../../data/types";

function renderTarget(target: string): ReactNode {
  const parts = target.split(/(\[\[[^\]]+\]\])/g);
  return parts.map((p, i) => {
    if (p.startsWith("[[") && p.endsWith("]]")) {
      return (
        <span
          key={i}
          style={{
            color: "var(--agent)",
            fontFamily: "var(--serif)",
            fontStyle: "italic",
          }}
        >
          {p.slice(2, -2).split("|")[0]}
        </span>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

export function CardsMode(): ReactNode {
  const {
    agents,
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

  const handleDelete = async (a: Agent) => {
    const ok = window.confirm(`Delete custom agent "${a.name}"?`);
    if (!ok) return;
    try {
      await deleteCustomAgent(a.id);
      await refreshCustomAgents();
      pushToast({
        icon: "🗑",
        agent: "archivist",
        body: `Deleted agent ${a.name}`,
      });
    } catch (err) {
      pushToast({
        icon: "⚠",
        agent: "sentinel",
        body: err instanceof Error ? err.message : "Delete failed",
      });
    }
  };

  const isCustom = (a: Agent) => customIds.has(a.id);

  const renderCard = (a: Agent) => (
    <div key={a.id} className="agent-card">
      <div className="agent-card-h">
        <AgentBlob agent={a.id} state={a.state} size={36} />
        <span className="agent-card-name">{a.name}</span>
        <StatusBadge state={a.state} />
        {!isCustom(a) && <span className="agent-card-lock" title="System agent">🔒</span>}
      </div>
      <div className="agent-card-role">{a.role}</div>
      <div className="agent-card-stats">
        <span>
          <b>{a.stats.runs}</b> runs
        </span>
        <span>last: {a.stats.lastRun}</span>
      </div>
      <div className="agent-card-last">{a.lastAction}</div>
      {isCustom(a) && (
        <div className="agent-card-actions">
          <button
            type="button"
            className="btn btn-md"
            onClick={() =>
              setEditing({
                id: a.id,
                name: a.name,
                layer: "shuttle",
                role: a.role,
                icon: a.icon,
                system_prompt: "",
                system: false,
              })
            }
            aria-label={`Edit ${a.name}`}
          >
            <Pencil size={13} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn btn-md"
            onClick={() => void handleDelete(a)}
            aria-label={`Delete ${a.name}`}
          >
            <Trash2 size={13} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );

  const addCard = (
    <button
      key="__add"
      type="button"
      className="agent-card agent-card--add"
      onClick={() => setAdding(true)}
    >
      <Plus size={18} aria-hidden="true" />
      <span>Add agent</span>
    </button>
  );

  return (
    <div>
      <div className="section-divider">Loom Layer · vault hygiene</div>
      <div className="agents-grid">{loom.map(renderCard)}</div>

      <div className="section-divider">Shuttle Layer · outbound</div>
      <div className="agents-grid">
        {shuttle.map(renderCard)}
        {addCard}
      </div>

      <div className="section-divider">Recent activity</div>
      <div className="changelog">
        {changelog.slice(0, 15).map((ev) => (
          <div key={ev.id} className="changelog-row">
            <span className="changelog-ts">{ev.ts}</span>
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
    </div>
  );
}
