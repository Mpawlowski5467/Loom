import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Loader2, Pencil, Play, Trash2 } from "lucide-react";
import { useFocusTrap } from "../../components/useFocusTrap";
import { StatusBadge } from "../../components/primitives/StatusBadge";
import { AgentBlob } from "../../components/primitives/AgentBlob";
import {
  getAgentRegistry,
  type AgentRegistryRecord,
} from "../../api/agentsRegistry";
import type { AgentActivity } from "../../api/activity";
import type { Agent } from "../../data/types";
import { boardStatus } from "./boardHelpers";
import { AgentActivityPanel } from "./AgentActivityPanel";

interface AgentDetailModalProps {
  agent: Agent;
  live: AgentActivity | undefined;
  isCustom: boolean;
  runnable: boolean;
  running: boolean;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
  pollMs?: number;
}

/**
 * Full-page inspector for one agent: identity + live status, its registry
 * instructions (persona prompt for built-ins), and recent activity (runs +
 * LLM calls). Opened by clicking an agent card's body.
 */
export function AgentDetailModal({
  agent,
  live,
  isCustom,
  runnable,
  running,
  onRun,
  onEdit,
  onDelete,
  onClose,
  pollMs,
}: AgentDetailModalProps): ReactNode {
  const [record, setRecord] = useState<AgentRegistryRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>({ onEscape: onClose });
  const status = boardStatus(agent, live);

  useEffect(() => {
    let cancelled = false;
    getAgentRegistry(agent.id)
      .then((r) => {
        if (!cancelled) setRecord(r);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load agent");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [agent.id]);

  const hasOverride = Boolean(record?.provider || record?.chat_model);

  return (
    <div
      className="settings-modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="settings-modal agent-detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="agent-detail-head">
          <AgentBlob agent={agent.id} state={status.state} size={40} />
          <div className="agent-detail-id">
            <h2 id="agent-detail-title" className="agent-detail-name">
              {agent.name}
            </h2>
            <div className="agent-detail-meta">
              <span className="agent-detail-layer">{agent.layer} layer</span>
              <span className="agent-detail-badge">
                {isCustom ? "custom" : "🔒 system"}
              </span>
            </div>
          </div>
          <StatusBadge state={status.state} label={status.label} />
        </div>

        <div className="agent-detail-role">{agent.role}</div>
        {hasOverride && (
          <div className="agent-detail-model">
            model: {record?.provider || "default provider"} ·{" "}
            {record?.chat_model || "default model"}
          </div>
        )}

        <div className="agent-detail-subhead">Instructions</div>
        {error && (
          <div className="settings-test-result fail" role="status">
            {error}
          </div>
        )}
        <pre className="agent-detail-instructions">
          {record ? record.system_prompt || "(none)" : error ? "—" : "Loading…"}
        </pre>

        <div className="agent-detail-subhead">Activity</div>
        <AgentActivityPanel agentId={agent.id} pollMs={pollMs} />

        <div className="settings-actions">
          {isCustom && (
            <>
              <button
                className="btn btn-md"
                type="button"
                onClick={onEdit}
                aria-label={`Edit ${agent.name}`}
              >
                <Pencil size={13} aria-hidden="true" />
                <span>edit</span>
              </button>
              <button
                className="btn btn-md"
                type="button"
                onClick={onDelete}
                aria-label={`Delete ${agent.name}`}
              >
                <Trash2 size={13} aria-hidden="true" />
                <span>delete</span>
              </button>
            </>
          )}
          <button className="btn btn-md" type="button" onClick={onClose}>
            Close
          </button>
          {runnable && (
            <button
              className="btn btn-md btn-active"
              type="button"
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
          )}
        </div>
      </div>
    </div>
  );
}
