import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { RunFeed } from "../../components/RunFeed";
import { TraceModal } from "../../components/TraceModal";
import { listTraces, type TraceSummary } from "../../api/traces";
import { callerMatchesAgent } from "./boardHelpers";

interface AgentActivityPanelProps {
  agentId: string;
  pollMs?: number;
}

/**
 * The ACTIVITY half of the agent detail modal: this agent's recent multi-step
 * runs (RunFeed filtered client-side on RunSummary.agent) and its recent raw
 * LLM calls (listTraces filtered on the caller label), each opening the
 * existing TraceModal inspector.
 */
export function AgentActivityPanel({
  agentId,
  pollMs = 3000,
}: AgentActivityPanelProps): ReactNode {
  const [calls, setCalls] = useState<TraceSummary[]>([]);
  const [openTrace, setOpenTrace] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const tick = async () => {
      // Skip the fetch while the tab is backgrounded (mirrors RunFeed and the
      // board's activity pollers) so a hidden window does no work.
      if (!document.hidden) {
        try {
          const all = await listTraces(200);
          if (!cancelled) {
            setCalls(all.filter((t) => callerMatchesAgent(t.caller, agentId)));
          }
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
  }, [agentId, pollMs]);

  return (
    <div className="agent-detail-activity">
      <section aria-label="Recent runs">
        <div className="agent-detail-subhead">Runs</div>
        <div className="agent-detail-feed">
          <RunFeed agent={agentId} limit={50} pollMs={pollMs} />
        </div>
      </section>
      <section aria-label="Recent LLM calls">
        <div className="agent-detail-subhead">LLM calls</div>
        <div className="agent-detail-feed trace-feed-body">
          {calls.length === 0 && (
            <div className="trace-feed-empty">No LLM calls yet.</div>
          )}
          {calls.map((t) => (
            <button
              key={t.id}
              type="button"
              className="trace-item"
              title="View raw call"
              onClick={() => setOpenTrace(t.id)}
            >
              <div className={`trace-item-meta${t.error ? " error" : ""}`}>
                <span>{new Date(t.timestamp).toLocaleTimeString()}</span>
                <span>·</span>
                <span className="trace-item-caller">{t.caller || "—"}</span>
                <span className="trace-item-dur">{t.duration_ms}ms</span>
              </div>
              <div className="trace-item-preview">
                {t.model} · {t.error || t.response_preview}
              </div>
            </button>
          ))}
        </div>
      </section>
      {openTrace && (
        <TraceModal traceId={openTrace} onClose={() => setOpenTrace(null)} />
      )}
    </div>
  );
}
