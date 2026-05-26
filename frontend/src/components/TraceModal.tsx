import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { fetchTrace } from "../api/traces";
import type { TraceDetail } from "../api/traces";

interface Props {
  traceId: string;
  onClose: () => void;
}

export function TraceModal({ traceId, onClose }: Props): ReactNode {
  const [trace, setTrace] = useState<TraceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTrace(null);
    setError(null);
    fetchTrace(traceId)
      .then((t) => {
        if (!cancelled) setTrace(t);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [traceId]);

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
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(20, 18, 15, 0.55)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-surface, #ede8da)",
          color: "var(--ink, #1a1815)",
          border: "1px solid rgba(26,24,21,0.18)",
          borderRadius: 8,
          maxWidth: 880,
          width: "100%",
          maxHeight: "85vh",
          overflow: "auto",
          padding: 20,
          fontFamily: "var(--sans, Inter, system-ui, sans-serif)",
          boxShadow: "0 12px 40px rgba(26,24,21,0.25)",
        }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 12,
          }}
        >
          <h3 style={{ margin: 0, fontFamily: "var(--serif, Fraunces, serif)" }}>
            LLM call
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontSize: 20,
              color: "var(--ink-2, #5c5851)",
            }}
          >
            ×
          </button>
        </header>

        {error && (
          <div style={{ color: "var(--you, #a83a2c)" }}>Error: {error}</div>
        )}
        {!trace && !error && <div>Loading…</div>}
        {trace && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: 8,
        fontFamily: "var(--mono, JetBrains Mono, monospace)",
        fontSize: 12,
        color: "var(--ink-2, #5c5851)",
        padding: "8px 10px",
        background: "var(--bg-elevated, #e3dcca)",
        borderRadius: 6,
      }}
    >
      {items.map(([k, v]) => (
        <div key={k}>
          <div style={{ opacity: 0.65 }}>{k}</div>
          <div style={{ color: "var(--ink, #1a1815)" }}>{v}</div>
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
      <div
        style={{
          fontFamily: "var(--mono, monospace)",
          fontSize: 11,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: "var(--ink-3, #8c877d)",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <pre
        style={{
          margin: 0,
          padding: "10px 12px",
          background: "var(--bg-base, #f5f1e8)",
          border: `1px solid ${danger ? "var(--you, #a83a2c)" : "rgba(26,24,21,0.12)"}`,
          borderRadius: 6,
          fontFamily: "var(--mono, monospace)",
          fontSize: 12,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          maxHeight: 320,
          overflow: "auto",
        }}
      >
        {body}
      </pre>
    </div>
  );
}
