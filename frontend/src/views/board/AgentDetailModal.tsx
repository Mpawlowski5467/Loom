import { Loader2, Pencil, Play, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  getAgentRegistry,
  type AgentRegistryRecord,
} from "@/api/agentsRegistry";
import { AgentAvatar } from "@/components/AgentAvatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Agent } from "@/data/types";
import { AgentActivityPanel } from "./AgentActivityPanel";
import { AgentStateBadge } from "./AgentStateBadge";
import { agentDisplayName } from "./boardHelpers";
import type { AgentBoardState } from "./boardStats";

interface AgentDetailModalProps {
  agent: Agent;
  state: AgentBoardState;
  isCustom: boolean;
  runnable: boolean;
  running: boolean;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
  pollMs?: number;
}

const heading =
  "font-mono text-[11px] tracking-wider text-muted-foreground uppercase";

/** One agent's logs: identity and state, its instructions, runs and LLM calls. */
export function AgentDetailModal(p: AgentDetailModalProps) {
  const { agent } = p;
  const [record, setRecord] = useState<AgentRegistryRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = agentDisplayName(agent);

  useEffect(() => {
    let cancelled = false;
    getAgentRegistry(agent.id).then(
      (r) => !cancelled && setRecord(r),
      (e: unknown) =>
        !cancelled &&
        setError(e instanceof Error ? e.message : "Failed to load agent"),
    );
    return () => {
      cancelled = true;
    };
  }, [agent.id]);

  const override = record && (record.provider || record.chat_model);
  return (
    <Dialog open onOpenChange={(open) => !open && p.onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[85vh] flex-col gap-5 overflow-y-auto sm:max-w-3xl"
      >
        <DialogHeader className="flex-row items-center gap-3 space-y-0 text-left">
          <AgentAvatar actor={agent.id} size="lg" />
          <div className="min-w-0 flex-1">
            <DialogTitle>{name}</DialogTitle>
            <DialogDescription>
              {agent.layer === "shuttle" ? "Shuttle layer" : "Loom layer"} ·{" "}
              {p.isCustom ? "custom agent" : "system agent"}
            </DialogDescription>
          </div>
          <AgentStateBadge state={p.state} />
        </DialogHeader>
        <div className="flex flex-col gap-1 text-sm">
          <p className="text-secondary-foreground">{agent.role}</p>
          {override && (
            <p className="font-mono text-xs text-muted-foreground">
              model: {record.provider || "default provider"} ·{" "}
              {record.chat_model || "default model"}
            </p>
          )}
        </div>
        <section className="flex flex-col gap-2">
          <h3 className={heading}>Instructions</h3>
          {error && (
            <p role="status" className="text-sm text-danger-foreground">
              {error}
            </p>
          )}
          <pre className="max-h-56 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap text-secondary-foreground">
            {record
              ? record.system_prompt || "(none)"
              : error
                ? "—"
                : "Loading…"}
          </pre>
        </section>
        <section className="flex flex-col gap-2">
          <h3 className={heading}>Activity</h3>
          <AgentActivityPanel agentId={agent.id} pollMs={p.pollMs} />
        </section>
        <DialogFooter className="gap-2">
          {p.isCustom && (
            <>
              <Button
                variant="ghost"
                onClick={p.onEdit}
                aria-label={`Edit ${name}`}
              >
                <Pencil aria-hidden="true" />
                Edit
              </Button>
              <Button
                variant="ghost"
                onClick={p.onDelete}
                aria-label={`Delete ${name}`}
              >
                <Trash2 aria-hidden="true" />
                Delete
              </Button>
            </>
          )}
          <Button variant="outline" onClick={p.onClose}>
            Close
          </Button>
          {p.runnable && (
            <Button
              onClick={p.onRun}
              disabled={p.running}
              aria-label={`Run ${name} now`}
            >
              {p.running ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : (
                <Play aria-hidden="true" />
              )}
              Run now
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
