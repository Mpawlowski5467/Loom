import type { ReactNode } from "react";
import { Loader2, Pencil, Play, Trash2 } from "lucide-react";
import { StatusBadge } from "../../components/primitives/StatusBadge";
import { AgentBlob } from "../../components/primitives/AgentBlob";
import type { AgentActivity } from "../../api/activity";
import type { Agent, AgentEvent } from "../../data/types";
import { boardStatus, formatAge, formatRelativeTime } from "./boardHelpers";

interface AgentCardProps {
  agent: Agent;
  live: AgentActivity | undefined;
  lastEvent: AgentEvent | undefined;
  isCustom: boolean;
  /** A loom agent that can be run from the board. */
  runnable: boolean;
  running: boolean;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function AgentCard({
  agent,
  live,
  lastEvent,
  isCustom,
  runnable,
  running,
  onRun,
  onEdit,
  onDelete,
}: AgentCardProps): ReactNode {
  const status = boardStatus(agent, live);
  const runs = live?.action_count ?? agent.stats.runs;
  const lastWhen = lastEvent
    ? formatRelativeTime(lastEvent.ts)
    : live?.last_finished_age_s != null
      ? formatAge(live.last_finished_age_s)
      : "never";
  const lastActionText = lastEvent
    ? `${lastEvent.action} ${lastEvent.target}`
    : agent.lastAction || "—";

  return (
    <div className="agent-card">
      <div className="agent-card-h">
        <AgentBlob agent={agent.id} state={status.state} size={36} />
        <span className="agent-card-name">{agent.name}</span>
        <StatusBadge state={status.state} label={status.label} />
        {!isCustom && (
          <span className="agent-card-lock" title="System agent">
            🔒
          </span>
        )}
      </div>
      <div className="agent-card-role">{agent.role}</div>
      <div className="agent-card-stats">
        <span>
          <b>{runs}</b> runs
        </span>
        <span title={lastEvent?.ts}>last: {lastWhen}</span>
      </div>
      <div className="agent-card-last" title={lastActionText}>
        {lastActionText}
      </div>
      {runnable && !isCustom && (
        <div className="agent-card-actions">
          <button
            type="button"
            className="btn btn-md"
            onClick={onRun}
            disabled={running}
            aria-label={`Run ${agent.name}`}
          >
            {running ? (
              <Loader2 size={13} aria-hidden="true" className="spin" />
            ) : (
              <Play size={13} aria-hidden="true" />
            )}
            <span>run</span>
          </button>
        </div>
      )}
      {isCustom && (
        <div className="agent-card-actions">
          <button
            type="button"
            className="btn btn-md"
            onClick={onEdit}
            aria-label={`Edit ${agent.name}`}
          >
            <Pencil size={13} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn btn-md"
            onClick={onDelete}
            aria-label={`Delete ${agent.name}`}
          >
            <Trash2 size={13} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
