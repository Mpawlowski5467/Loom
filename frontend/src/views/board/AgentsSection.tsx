import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { RUNNABLE_LOOM_AGENTS } from "@/api/agents";
import { getAgentRegistry } from "@/api/agentsRegistry";
import { useApp } from "@/context/app-ctx";
import type { Agent, AgentEvent } from "@/data/types";
import { AgentCard } from "./AgentCard";
import { BoardModals, type BoardModal } from "./BoardModals";
import { agentDisplayName } from "./boardHelpers";
import {
  agentBoardState,
  type AgentStateContext,
  type BoardStats,
} from "./boardStats";
import { ShuttleCard, type ShuttleRow } from "./ShuttleCard";
import { useAgentRunner } from "./useAgentRunner";

const PIPELINE_ONLY = "Runs as a step of the capture pipeline, not on its own.";

/** Loom agent cards, the Shuttle card, and every agent dialog. */
export function AgentsSection({
  stats,
  stateCtx,
}: {
  stats: BoardStats;
  stateCtx: AgentStateContext;
}) {
  const { agents, agentActivity, changelog, customAgents, pushToast } =
    useApp();
  const runner = useAgentRunner();
  const [modal, setModal] = useState<BoardModal>(null);
  useAgentDeepLink((id) => setModal({ kind: "detail", id }));

  const customIds = useMemo(
    () => new Set(customAgents.map((a) => a.id)),
    [customAgents],
  );
  const merged = useMemo(
    () => [...agents.filter((a) => !customIds.has(a.id)), ...customAgents],
    [agents, customAgents, customIds],
  );
  const lastEvent = useMemo(() => {
    const map = new Map<string, AgentEvent>();
    for (const ev of changelog) if (!map.has(ev.agent)) map.set(ev.agent, ev);
    return map;
  }, [changelog]);
  const stateOf = (a: Agent) =>
    agentBoardState(a.id, agentActivity[a.id], stateCtx);
  const isRunnable = (a: Agent) =>
    RUNNABLE_LOOM_AGENTS.has(a.id) || customIds.has(a.id);
  const edit = async (a: Agent) => {
    try {
      setModal({ kind: "edit", record: await getAgentRegistry(a.id) });
    } catch (err) {
      pushToast({
        icon: "⚠",
        agent: "sentinel",
        body: `Couldn't load ${agentDisplayName(a)}: ${err instanceof Error ? err.message : "unknown error"}`,
      });
    }
  };

  const shuttle: ShuttleRow[] = merged
    .filter((a) => a.layer === "shuttle")
    .map((a) => ({
      agent: a,
      state: stateOf(a),
      running: runner.running.has(a.id),
      action: customIds.has(a.id)
        ? { label: "Run", run: () => void runner.run(a) }
        : a.id === "researcher"
          ? { label: "Ask", run: () => setModal({ kind: "researcher" }) }
          : a.id === "standup"
            ? { label: "Open", run: () => setModal({ kind: "standup" }) }
            : null,
    }));

  return (
    <section aria-labelledby="board-agents" className="flex flex-col gap-3">
      <h2 id="board-agents" className="text-sm font-medium text-foreground">
        Agents
      </h2>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {merged
          .filter((a) => a.layer === "loom")
          .map((a) => (
            <AgentCard
              key={a.id}
              agent={a}
              state={stateOf(a)}
              lastEvent={lastEvent.get(a.id)}
              weekActions={stats.perAgent.get(a.id) ?? 0}
              runBlocked={isRunnable(a) ? undefined : PIPELINE_ONLY}
              running={runner.running.has(a.id)}
              onRun={() => void runner.run(a)}
              onLogs={() => setModal({ kind: "detail", id: a.id })}
            />
          ))}
        <ShuttleCard
          rows={shuttle}
          onLogs={(a) => setModal({ kind: "detail", id: a.id })}
          onAdd={() => setModal({ kind: "add" })}
        />
      </div>
      <BoardModals
        modal={modal}
        setModal={setModal}
        agents={merged}
        customIds={customIds}
        stateOf={stateOf}
        isRunnable={isRunnable}
        running={runner.running}
        onRun={(a) => void runner.run(a)}
        onEdit={(a) => void edit(a)}
      />
    </section>
  );
}

/** `/board?agent=<id>` (from the palette) opens that agent's details once. */
function useAgentDeepLink(open: (id: string) => void) {
  const [params, setParams] = useSearchParams();
  const requested = params.get("agent");
  const [handled, setHandled] = useState<string | null>(null);
  if (requested !== handled) {
    setHandled(requested);
    if (requested) open(requested);
  }
  useEffect(() => {
    if (!requested) return;
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("agent");
        return next;
      },
      { replace: true },
    );
  }, [requested, setParams]);
}
