import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Loader2, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { useApp } from "../../context/app-ctx";
import { StatusBadge } from "../../components/primitives/StatusBadge";
import { AgentBlob } from "../../components/primitives/AgentBlob";
import { AddAgentModal } from "./AddAgentModal";
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

function renderTarget(target: string): ReactNode {
  // Backend may send a bare path like "topics/raft.md" or a wrapped wikilink.
  // Wrap bare paths so they pick up the styling.
  const wrapped =
    target.includes("[[") || !target
      ? target
      : `[[${target.replace(/\.md$/i, "")}]]`;
  const parts = wrapped.split(/(\[\[[^\]]+\]\])/g);
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

function formatRelativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const secs = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

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

  const handleRun = async (a: Agent) => {
    const key = a.name.toLowerCase();
    if (runningAgents.has(key)) return;
    setRunningAgents((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    try {
      const res = await runAgent(key);
      pushToast({
        icon: "▶",
        agent: key,
        body: formatRunResult(key, res.result),
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
        next.delete(key);
        return next;
      });
    }
  };

  // Per-agent last event: changelog feed is sorted newest-first, so the first
  // hit per agent is its most recent activity.
  const lastEventByAgent = useMemo(() => {
    const map = new Map<string, (typeof changelog)[number]>();
    for (const ev of changelog) {
      if (!map.has(ev.agent)) map.set(ev.agent, ev);
    }
    return map;
  }, [changelog]);

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

  const renderCard = (a: Agent) => {
    const live = agentActivity[a.name.toLowerCase()];
    const liveState: Agent["state"] =
      live?.state === "running" ? "running" : a.state;
    const liveRuns = live?.action_count ?? a.stats.runs;

    const lastEvent = lastEventByAgent.get(a.name.toLowerCase());
    const lastWhen = lastEvent
      ? formatRelativeTime(lastEvent.ts)
      : live?.last_finished_age_s != null
        ? formatRelativeTime(
            new Date(Date.now() - live.last_finished_age_s * 1000).toISOString(),
          )
        : "never";
    const lastActionText = lastEvent
      ? `${lastEvent.action} ${lastEvent.target}`
      : a.lastAction || "—";

    return (
    <div key={a.id} className="agent-card">
      <div className="agent-card-h">
        <AgentBlob agent={a.id} state={liveState} size={36} />
        <span className="agent-card-name">{a.name}</span>
        <StatusBadge state={liveState} />
        {!isCustom(a) && <span className="agent-card-lock" title="System agent">🔒</span>}
      </div>
      <div className="agent-card-role">{a.role}</div>
      <div className="agent-card-stats">
        <span>
          <b>{liveRuns}</b> runs
        </span>
        <span title={lastEvent?.ts}>last: {lastWhen}</span>
      </div>
      <div className="agent-card-last" title={lastActionText}>
        {lastActionText}
      </div>
      {!isCustom(a) && RUNNABLE_LOOM_AGENTS.has(a.name.toLowerCase()) && (
        <div className="agent-card-actions">
          <button
            type="button"
            className="btn btn-md"
            onClick={() => void handleRun(a)}
            disabled={runningAgents.has(a.name.toLowerCase())}
            aria-label={`Run ${a.name}`}
          >
            {runningAgents.has(a.name.toLowerCase()) ? (
              <Loader2 size={13} aria-hidden="true" className="spin" />
            ) : (
              <Play size={13} aria-hidden="true" />
            )}
            <span>run</span>
          </button>
        </div>
      )}
      {isCustom(a) && (
        <div className="agent-card-actions">
          <button
            type="button"
            className="btn btn-md"
            onClick={async () => {
              try {
                const full = await getAgentRegistry(a.id);
                setEditing(full);
              } catch (err) {
                pushToast({
                  icon: "⚠",
                  agent: "sentinel",
                  body: `Failed to load ${a.name}: ${err instanceof Error ? err.message : "unknown error"}`,
                });
              }
            }}
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
  };

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
        {changelog.length === 0 && (
          <div
            style={{
              padding: "12px 4px",
              fontSize: 12,
              color: "var(--ink-3)",
              fontStyle: "italic",
            }}
          >
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
    </div>
  );
}
