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
  /** An agent that can be run from the board (runnable built-ins + customs). */
  runnable: boolean;
  running: boolean;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
  /** Open the agent detail modal (clicking the card body / Enter / Space). */
  onOpen: () => void;
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
  onOpen,
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

  // The card body is a keyboard-operable button (a real <button> would nest
  // the action buttons inside it, which is invalid HTML).
  return (
    <div
      className="agent-card agent-card--clickable"
      role="button"
      tabIndex={0}
      aria-label={`${agent.name} details`}
      onClick={onOpen}
      onKeyDown={(e) => {
        // Only when the card itself is focused: keydown on the inner action
        // buttons bubbles here too, and Enter on "run" must not also open
        // the modal (their click handlers stopPropagation; keydown doesn't).
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
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
      {(runnable || isCustom) && (
        <div className="agent-card-actions">
          {runnable && (
            <button
              type="button"
              className="btn btn-md"
              onClick={(e) => {
                e.stopPropagation();
                onRun();
              }}
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
          )}
          {isCustom && (
            <>
              <button
                type="button"
                className="btn btn-md"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
                aria-label={`Edit ${agent.name}`}
              >
                <Pencil size={13} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="btn btn-md"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                aria-label={`Delete ${agent.name}`}
              >
                <Trash2 size={13} aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
