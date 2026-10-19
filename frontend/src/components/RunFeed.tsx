import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  fetchRun,
  listRuns,
  type RunDetail,
  type RunSummary,
} from "../api/runs";
import { TraceModal } from "./TraceModal";
import { RunUndo } from "./RunUndo";
import { cn } from "@/lib/utils";

interface Props {
  /** Only show runs made by this agent (matches RunSummary.agent). */
  agent?: string;
  limit?: number;
  pollMs?: number;
}

/**
 * Lists recent multi-step agent runs. Expanding a run reveals its ordered step
 * timeline; each step that made LLM calls can be drilled into the existing
 * raw-call inspector (TraceModal).
 */
export function RunFeed({
  agent,
  limit = 20,
  pollMs = 3000,
}: Props): ReactNode {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [openTrace, setOpenTrace] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const tick = async () => {
      // Skip the fetch while the tab is backgrounded (mirrors
      // useHealthPolling / useAgentPolling) so a hidden window does no work.
      if (!document.hidden) {
        try {
          // Agent filtering is client-side (below), so fetch the deepest
          // window the API allows — otherwise a quiet agent whose runs are
          // older than the newest `limit` would wrongly show "no runs yet".
          const next = await listRuns(agent ? 200 : limit);
          if (!cancelled) setRuns(next);
        } catch {
          // best-effort
        }
      }
      if (!cancelled) timer = window.setTimeout(tick, pollMs);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [agent, limit, pollMs]);

  const toggle = async (runId: string) => {
    if (expanded === runId) {
      setExpanded(null);
      setDetail(null);
      return;
    }
    setExpanded(runId);
    setDetail(null);
    try {
      setDetail(await fetchRun(runId));
    } catch {
      // best-effort — the step timeline falls back to the summary
    }
  };

  const stepsFor = (runId: string): RunSummary["steps"] =>
    detail && detail.run_id === runId
      ? detail.steps
      : (runs.find((r) => r.run_id === runId)?.steps ?? []);

  // /api/traces/runs has no agent query param, so filtering is client-side.
  const visible = agent
    ? runs.filter((r) => r.agent === agent).slice(0, limit)
    : runs;

  return (
    <div className="flex flex-col">
      {visible.length === 0 && (
        <p className="p-3 text-sm text-muted-foreground">
          {agent
            ? "No runs yet for this agent."
            : "No runs yet. Run the Researcher or Standup agent."}
        </p>
      )}
      {visible.map((run) => (
        <div
          key={run.run_id}
          className="border-b border-border last:border-b-0"
        >
          <button
            type="button"
            onClick={() => void toggle(run.run_id)}
            aria-expanded={expanded === run.run_id}
            className="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <span
              className={cn(
                "flex gap-1.5 font-mono text-[11px]",
                run.status === "error"
                  ? "text-danger-foreground"
                  : "text-muted-foreground",
              )}
            >
              <span>{new Date(run.started).toLocaleTimeString()}</span>
              <span>·</span>
              <span>{run.agent}</span>
              <span>·</span>
              <span>{run.steps.length} steps</span>
              <span className="ml-auto">{run.duration_ms} ms</span>
            </span>
            <span className="truncate text-xs text-secondary-foreground">
              {run.steps.map((s) => s.name).join(" → ")}
            </span>
          </button>
          {expanded === run.run_id && (
            <ol
              className="flex flex-col gap-1 px-3 pb-2"
              aria-label={`Steps for ${run.agent} run`}
            >
              {stepsFor(run.run_id).map((step) => {
                const calls = detail?.traces?.[step.name] ?? [];
                return (
                  <li key={step.name} className="flex flex-col gap-1 text-xs">
                    <span
                      className={cn(
                        "flex justify-between font-mono",
                        step.status === "error"
                          ? "text-danger-foreground"
                          : "text-secondary-foreground",
                      )}
                    >
                      <span>{step.name}</span>
                      <span>{step.duration_ms} ms</span>
                    </span>
                    {step.error && (
                      <span className="text-danger-foreground">
                        {step.error}
                      </span>
                    )}
                    {calls.map((call) => (
                      <button
                        key={call.id}
                        type="button"
                        onClick={() => setOpenTrace(call.id)}
                        title="View raw call"
                        className="self-start rounded-sm font-mono text-[11px] text-brand hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        {call.model} · {call.duration_ms}ms
                      </button>
                    ))}
                  </li>
                );
              })}
            </ol>
          )}
          {expanded === run.run_id && (
            <RunUndo key={run.run_id} runId={run.run_id} />
          )}
        </div>
      ))}
      {openTrace && (
        <TraceModal traceId={openTrace} onClose={() => setOpenTrace(null)} />
      )}
    </div>
  );
}
