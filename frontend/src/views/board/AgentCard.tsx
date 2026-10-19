import { Loader2, Play, ScrollText } from "lucide-react";
import { AgentAvatar } from "@/components/AgentAvatar";
import { Button } from "@/components/ui/button";
import type { Agent, AgentEvent } from "@/data/types";
import { AgentStateBadge } from "./AgentStateBadge";
import type { AgentBoardState } from "./boardStats";
import {
  agentDisplayName,
  formatRelativeTime,
  renderTarget,
} from "./boardHelpers";

interface AgentCardProps {
  agent: Agent;
  state: AgentBoardState;
  lastEvent: AgentEvent | undefined;
  /** Actions in the feed window (about a week). */
  weekActions: number;
  /** Why Run now is unavailable (pipeline-only agents), if it is. */
  runBlocked?: string;
  running: boolean;
  onRun: () => void;
  onLogs: () => void;
}

/** One Loom Layer agent: identity, state, last action, a stat and actions. */
export function AgentCard(p: AgentCardProps) {
  const name = agentDisplayName(p.agent);
  return (
    <article
      aria-labelledby={`agent-${p.agent.id}`}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <header className="flex items-start gap-3">
        <AgentAvatar actor={p.agent.id} size="lg" />
        <div className="min-w-0 flex-1">
          <h3
            id={`agent-${p.agent.id}`}
            className="font-medium text-foreground"
          >
            {name}
          </h3>
          <p
            className="truncate text-xs text-muted-foreground"
            title={p.agent.role}
          >
            {p.agent.role}
          </p>
        </div>
        <AgentStateBadge state={p.state} />
      </header>
      <p className="line-clamp-2 min-h-10 text-sm text-secondary-foreground">
        {p.lastEvent ? (
          <>
            {p.lastEvent.action} {renderTarget(p.lastEvent.target)}{" "}
            <span
              className="text-xs text-muted-foreground"
              title={p.lastEvent.ts}
            >
              · {formatRelativeTime(p.lastEvent.ts)}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">No actions yet.</span>
        )}
      </p>
      <p className="font-mono text-xs text-muted-foreground tabular-nums">
        {p.weekActions} {p.weekActions === 1 ? "action" : "actions"} this week
      </p>
      <footer className="mt-auto flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={p.onLogs}
          aria-label={`${name} logs`}
        >
          <ScrollText aria-hidden="true" />
          Logs
        </Button>
        <span title={p.runBlocked}>
          <Button
            size="sm"
            onClick={p.onRun}
            disabled={p.running || Boolean(p.runBlocked)}
            aria-label={`Run ${name} now`}
          >
            {p.running ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : (
              <Play aria-hidden="true" />
            )}
            Run now
          </Button>
        </span>
      </footer>
    </article>
  );
}
