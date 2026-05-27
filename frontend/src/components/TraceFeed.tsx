import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  listTraceDates,
  listTraces,
  listTracesDisk,
  type TraceSummary,
} from "../api/traces";
import { TraceModal } from "./TraceModal";

interface Props {
  limit?: number;
  pollMs?: number;
}

const FILTER_LS_KEY = "loom.traceFeed.caller";
const ALL = "__all__";

function loadStoredFilter(): string {
  if (typeof window === "undefined") return ALL;
  try {
    return window.localStorage.getItem(FILTER_LS_KEY) || ALL;
  } catch {
    return ALL;
  }
}

function persistFilter(value: string): void {
  if (typeof window === "undefined") return;
  try {
    if (value === ALL) window.localStorage.removeItem(FILTER_LS_KEY);
    else window.localStorage.setItem(FILTER_LS_KEY, value);
  } catch {
    // quota / privacy mode — ignore
  }
}

export function TraceFeed({ limit = 20, pollMs = 2000 }: Props): ReactNode {
  const [live, setLive] = useState<TraceSummary[]>([]);
  const [older, setOlder] = useState<TraceSummary[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>(() => loadStoredFilter());
  const [loadingOlder, setLoadingOlder] = useState(false);
  const olderDateCursor = useRef<string | null>(null);
  const dateExhausted = useRef<boolean>(false);

  // Poll the in-memory ring buffer. Filter is applied client-side so the
  // dropdown options reflect the full set of callers in view.
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const tick = async () => {
      try {
        const next = await listTraces(limit);
        if (!cancelled) setLive(next);
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

  // Older-traces accumulator resets when the filter changes so the user
  // doesn't see stale older-than-filter pages.
  useEffect(() => {
    setOlder([]);
    olderDateCursor.current = null;
    dateExhausted.current = false;
  }, [filter]);

  const allItems = useMemo<TraceSummary[]>(() => {
    const seen = new Set<string>();
    const merged: TraceSummary[] = [];
    for (const t of [...live, ...older]) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      merged.push(t);
    }
    return merged;
  }, [live, older]);

  const callers = useMemo(() => {
    const s = new Set<string>();
    for (const t of allItems) s.add(t.caller || "—");
    return [...s].sort();
  }, [allItems]);

  const visible = useMemo(() => {
    if (filter === ALL) return allItems;
    const target = filter === "—" ? "" : filter;
    return allItems.filter((t) => (t.caller || "") === target);
  }, [allItems, filter]);

  const loadOlder = async () => {
    if (loadingOlder || dateExhausted.current) return;
    setLoadingOlder(true);
    try {
      // Walk the disk-dated folders newest → oldest, one page at a time.
      const { dates } = await listTraceDates();
      if (dates.length === 0) {
        dateExhausted.current = true;
        return;
      }
      const cursor = olderDateCursor.current;
      const startIdx = cursor === null ? 0 : dates.indexOf(cursor) + 1;
      if (startIdx >= dates.length) {
        dateExhausted.current = true;
        return;
      }
      const targetDate = dates[startIdx]!;
      const callerArg = filter === ALL || filter === "—" ? undefined : filter;
      const page = await listTracesDisk(targetDate, callerArg, 200);
      olderDateCursor.current = targetDate;
      setOlder((prev) => [...prev, ...page]);
      if (startIdx + 1 >= dates.length) dateExhausted.current = true;
    } catch {
      // best-effort
    } finally {
      setLoadingOlder(false);
    }
  };

  const onFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setFilter(value);
    persistFilter(value);
  };

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
          alignItems: "center",
          gap: 10,
        }}
      >
        <span>llm calls</span>
        <select
          aria-label="Filter trace caller"
          value={filter}
          onChange={onFilterChange}
          style={{
            marginLeft: "auto",
            background: "var(--bg-base)",
            color: "var(--ink-2)",
            border: "1px solid rgba(26,24,21,0.18)",
            borderRadius: 4,
            fontFamily: "var(--mono, monospace)",
            fontSize: 10.5,
            padding: "2px 6px",
            textTransform: "none",
          }}
        >
          <option value={ALL}>all ({allItems.length})</option>
          {callers.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <span>{visible.length}</span>
      </div>
      <div style={{ overflow: "auto", flex: 1 }}>
        {visible.length === 0 && (
          <div
            style={{
              padding: "16px 12px",
              fontSize: 12,
              color: "var(--ink-3)",
              fontStyle: "italic",
            }}
          >
            {filter === ALL
              ? "No calls yet. Send a council message or process a capture."
              : `No calls matching ${filter}.`}
          </div>
        )}
        {visible.map((t) => (
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
        <button
          type="button"
          onClick={() => void loadOlder()}
          disabled={loadingOlder || dateExhausted.current}
          style={{
            display: "block",
            width: "100%",
            padding: "8px 12px",
            background: "transparent",
            border: "none",
            borderTop: "1px solid rgba(26,24,21,0.06)",
            cursor:
              loadingOlder || dateExhausted.current ? "default" : "pointer",
            fontFamily: "var(--mono, monospace)",
            fontSize: 10.5,
            color: "var(--ink-3)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          {loadingOlder
            ? "loading…"
            : dateExhausted.current
              ? "no older traces"
              : "load older"}
        </button>
      </div>
      {openId && (
        <TraceModal traceId={openId} onClose={() => setOpenId(null)} />
      )}
    </aside>
  );
}
