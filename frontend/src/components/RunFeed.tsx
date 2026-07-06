import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { fetchRun, listRuns, type RunDetail, type RunSummary } from "../api/runs";
import { TraceModal } from "./TraceModal";

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
export function RunFeed({ agent, limit = 20, pollMs = 3000 }: Props): ReactNode {
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
    <div className="trace-feed-body">
      {visible.length === 0 && (
        <div className="trace-feed-empty">
          {agent
            ? "No runs yet for this agent."
            : "No runs yet. Run the Researcher or Standup agent."}
        </div>
      )}
      {visible.map((run) => (
        <div key={run.run_id}>
          <button
            type="button"
            onClick={() => void toggle(run.run_id)}
            aria-expanded={expanded === run.run_id}
            className="trace-item"
          >
            <div className={`trace-item-meta${run.status === "error" ? " error" : ""}`}>
              <span>{new Date(run.started).toLocaleTimeString()}</span>
              <span>·</span>
              <span className="trace-item-caller">{run.agent}</span>
              <span>·</span>
              <span>{run.steps.length} steps</span>
              <span className="trace-item-dur">{run.duration_ms}ms</span>
            </div>
            <div className="trace-item-preview">
              {run.steps.map((s) => s.name).join(" → ")}
            </div>
          </button>
          {expanded === run.run_id && (
            <ol className="run-steps" aria-label={`Steps for ${run.agent} run`}>
              {stepsFor(run.run_id).map((step) => {
                const calls = detail?.traces?.[step.name] ?? [];
                return (
                  <li key={step.name} className="run-step">
                    <div className={`run-step-row${step.status === "error" ? " error" : ""}`}>
                      <span className="run-step-name">{step.name}</span>
                      <span className="run-step-dur">{step.duration_ms}ms</span>
                    </div>
                    {step.error && <div className="run-step-error">⚠ {step.error}</div>}
                    {calls.map((call) => (
                      <button
                        key={call.id}
                        type="button"
                        onClick={() => setOpenTrace(call.id)}
                        title="View raw call"
                        className="run-step-call"
                      >
                        {call.model} · {call.duration_ms}ms
                      </button>
                    ))}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      ))}
      {openTrace && (
        <TraceModal traceId={openTrace} onClose={() => setOpenTrace(null)} />
      )}
    </div>
  );
}
