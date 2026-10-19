import { Loader2, Plus } from "lucide-react";
import { AgentAvatar } from "@/components/AgentAvatar";
import { Button } from "@/components/ui/button";
import type { Agent } from "@/data/types";
import { AgentStateBadge } from "./AgentStateBadge";
import type { AgentBoardState } from "./boardStats";
import { agentDisplayName } from "./boardHelpers";

export interface ShuttleRow {
  agent: Agent;
  state: AgentBoardState;
  /** The row's main action: open a workspace, or run a custom agent. */
  action: { label: string; run: () => void } | null;
  running: boolean;
}

interface ShuttleCardProps {
  rows: ShuttleRow[];
  onLogs: (agent: Agent) => void;
  onAdd: () => void;
}

/** One dashed card for the Shuttle Layer: they produce captures for Loom. */
export function ShuttleCard({ rows, onLogs, onAdd }: ShuttleCardProps) {
  return (
    <section
      aria-labelledby="shuttle-agents"
      className="flex flex-col gap-3 rounded-lg border border-dashed border-border-strong p-4"
    >
      <header className="flex items-start gap-2">
        <div className="flex-1">
          <h3 id="shuttle-agents" className="font-medium text-foreground">
            Shuttle agents
          </h3>
          <p className="text-xs text-muted-foreground">
            They write captures; Loom agents file them.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onAdd}>
          <Plus aria-hidden="true" />
          Add agent
        </Button>
      </header>
      <ul className="flex flex-col gap-1">
        {rows.map(({ agent, state, action, running }) => (
          <li key={agent.id} className="flex items-center gap-2 py-1">
            <AgentAvatar actor={agent.id} size="md" />
            <button
              type="button"
              onClick={() => onLogs(agent)}
              className="min-w-0 flex-1 truncate rounded-sm text-left text-sm text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              title={agent.role}
              aria-label={`${agentDisplayName(agent)} logs`}
            >
              {agentDisplayName(agent)}
            </button>
            <AgentStateBadge state={state} />
            {action && (
              <Button
                variant="outline"
                size="xs"
                onClick={action.run}
                disabled={running}
                aria-label={`${action.label} ${agentDisplayName(agent)}`}
              >
                {running && (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                )}
                {action.label}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
