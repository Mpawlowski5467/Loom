import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { fetchTrace } from "../api/traces";
import type { TraceDetail } from "../api/traces";

interface Props {
  traceId: string;
  onClose: () => void;
}

export function TraceModal({ traceId, onClose }: Props): ReactNode {
  // Tag the result with its traceId so a stale fetch never renders against a
  // newer id — lets us avoid resetting state synchronously inside the effect.
  const [result, setResult] = useState<{
    id: string;
    trace: TraceDetail | null;
    error: string | null;
  }>({ id: "", trace: null, error: null });

  useEffect(() => {
    let cancelled = false;
    fetchTrace(traceId)
      .then((t) => {
        if (!cancelled) setResult({ id: traceId, trace: t, error: null });
      })
      .catch((e) => {
        if (!cancelled) {
          setResult({
            id: traceId,
            trace: null,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [traceId]);

  const current = result.id === traceId ? result : null;
  const trace = current?.trace ?? null;
  const error = current?.error ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="trace-modal-overlay"
    >
      <div onClick={(e) => e.stopPropagation()} className="trace-modal">
        <header className="trace-modal-header">
          <h3>LLM call</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="trace-modal-close"
          >
            ×
          </button>
        </header>

        {error && <div className="trace-modal-error">Error: {error}</div>}
        {!trace && !error && (
          <div className="trace-modal-loading">Loading…</div>
        )}
        {trace && (
          <div className="trace-modal-body">
            <Meta trace={trace} />
            <Section label="System prompt" body={trace.system || "(none)"} />
            {trace.messages.map((m, i) => (
              <Section
                key={i}
                label={`Message ${i + 1} — ${m.role}`}
                body={m.content}
              />
            ))}
            <Section
              label={trace.error ? "Error" : "Response"}
              body={trace.error || trace.response}
              danger={!!trace.error}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function Meta({ trace }: { trace: TraceDetail }): ReactNode {
  const items: [string, string][] = [
    ["caller", trace.caller || "—"],
    ["provider", trace.provider],
    ["model", trace.model || "—"],
    ["latency", `${trace.duration_ms} ms`],
    ["at", new Date(trace.timestamp).toLocaleString()],
  ];
  return (
    <div className="trace-meta">
      {items.map(([k, v]) => (
        <div key={k}>
          <div className="trace-meta-key">{k}</div>
          <div className="trace-meta-val">{v}</div>
        </div>
      ))}
    </div>
  );
}

function Section({
  label,
  body,
  danger,
}: {
  label: string;
  body: string;
  danger?: boolean;
}): ReactNode {
  return (
    <div>
      <div className="trace-section-label">{label}</div>
      <pre className={`trace-section-body${danger ? " danger" : ""}`}>
        {body}
      </pre>
    </div>
  );
}
