import { useEffect, useState } from "react";
import { listTraces, type TraceSummary } from "@/api/traces";
import { RunFeed } from "@/components/RunFeed";
import { TraceModal } from "@/components/TraceModal";
import { cn } from "@/lib/utils";
import { callerMatchesAgent } from "./boardHelpers";

interface AgentActivityPanelProps {
  agentId: string;
  pollMs?: number;
}

const sub = "text-xs font-medium text-secondary-foreground";

/**
 * This agent's recent multi-step runs and raw LLM calls, each opening the
 * raw-call inspector. Polls while open; skips work in a hidden tab.
 */
export function AgentActivityPanel({
  agentId,
  pollMs = 3000,
}: AgentActivityPanelProps) {
  const [calls, setCalls] = useState<TraceSummary[]>([]);
  const [openTrace, setOpenTrace] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const tick = async () => {
      if (!document.hidden) {
        try {
          const all = await listTraces(200);
          if (!cancelled)
            setCalls(all.filter((t) => callerMatchesAgent(t.caller, agentId)));
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
    <div className="grid gap-4 md:grid-cols-2">
      <section aria-label="Recent runs" className="flex min-w-0 flex-col gap-2">
        <h4 className={sub}>Runs</h4>
        <div className="max-h-72 overflow-y-auto rounded-md border border-border">
          <RunFeed agent={agentId} limit={50} pollMs={pollMs} />
        </div>
      </section>
      <section
        aria-label="Recent LLM calls"
        className="flex min-w-0 flex-col gap-2"
      >
        <h4 className={sub}>LLM calls</h4>
        <ul className="max-h-72 overflow-y-auto rounded-md border border-border">
          {calls.length === 0 && (
            <li className="p-3 text-sm text-muted-foreground">
              No LLM calls yet.
            </li>
          )}
          {calls.map((t) => (
            <li key={t.id} className="border-b border-border last:border-b-0">
              <button
                type="button"
                title="View raw call"
                onClick={() => setOpenTrace(t.id)}
                className="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span
                  className={cn(
                    "flex gap-1.5 font-mono text-[11px]",
                    t.error
                      ? "text-danger-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  <span>{new Date(t.timestamp).toLocaleTimeString()}</span>
                  <span>·</span>
                  <span className="truncate">{t.caller || "—"}</span>
                  <span className="ml-auto">{t.duration_ms} ms</span>
                </span>
                <span className="truncate text-xs text-secondary-foreground">
                  {t.model} · {t.error || t.response_preview}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      {openTrace && (
        <TraceModal traceId={openTrace} onClose={() => setOpenTrace(null)} />
      )}
    </div>
  );
}
