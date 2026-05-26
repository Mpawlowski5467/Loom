import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { listTraces } from "../api/traces";
import type { TraceSummary } from "../api/traces";
import { TraceModal } from "./TraceModal";

interface Props {
  limit?: number;
  pollMs?: number;
}

export function TraceFeed({ limit = 20, pollMs = 2000 }: Props): ReactNode {
  const [items, setItems] = useState<TraceSummary[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const tick = async () => {
      try {
        const next = await listTraces(limit);
        if (!cancelled) setItems(next);
      } catch {
        // best-effort
      }
      if (!cancelled) timer = window.setTimeout(tick, pollMs);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [limit, pollMs]);

  return (
    <aside
      aria-label="LLM call log"
      style={{
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-surface)",
        border: "1px solid rgba(26,24,21,0.08)",
        borderRadius: 6,
        overflow: "hidden",
        minHeight: 0,
      }}
    >
      <div
        style={{
          padding: "10px 12px",
          borderBottom: "1px solid rgba(26,24,21,0.08)",
          fontFamily: "var(--mono, monospace)",
          fontSize: 11,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: "var(--ink-3, #8c877d)",
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>llm calls</span>
        <span>{items.length}</span>
      </div>
      <div style={{ overflow: "auto", flex: 1 }}>
        {items.length === 0 && (
          <div
            style={{
              padding: "16px 12px",
              fontSize: 12,
              color: "var(--ink-3)",
              fontStyle: "italic",
            }}
          >
            No calls yet. Send a council message or process a capture.
          </div>
        )}
        {items.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setOpenId(t.id)}
            title="View raw call"
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "8px 12px",
              background: "transparent",
              border: "none",
              borderBottom: "1px solid rgba(26,24,21,0.06)",
              cursor: "pointer",
              fontFamily: "var(--sans, Inter, system-ui)",
              color: "var(--ink, #1a1815)",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "var(--bg-elevated)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "transparent")
            }
          >
            <div
              style={{
                display: "flex",
                gap: 8,
                fontSize: 11,
                fontFamily: "var(--mono, monospace)",
                color: t.error ? "var(--you)" : "var(--ink-2)",
                marginBottom: 3,
              }}
            >
              <span>{new Date(t.timestamp).toLocaleTimeString()}</span>
              <span>·</span>
              <span style={{ color: "var(--agent)" }}>{t.caller || "—"}</span>
              <span>·</span>
              <span>{t.model}</span>
              <span style={{ marginLeft: "auto" }}>{t.duration_ms}ms</span>
            </div>
            <div
              style={{
                fontSize: 12,
                color: "var(--ink-2)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {t.error ? `⚠ ${t.error}` : t.response_preview}
            </div>
          </button>
        ))}
      </div>
      {openId && (
        <TraceModal traceId={openId} onClose={() => setOpenId(null)} />
      )}
    </aside>
  );
}
