import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  listTraceDates,
  listTraces,
  listTracesDisk,
  type TraceSummary,
} from "../api/traces";
import { RunFeed } from "./RunFeed";
import { TraceModal } from "./TraceModal";

interface Props {
  limit?: number;
  pollMs?: number;
}

type Tab = "calls" | "runs";

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
  const [tab, setTab] = useState<Tab>("calls");
  const olderDateCursor = useRef<string | null>(null);
  const dateExhausted = useRef<boolean>(false);

  // Poll the in-memory ring buffer. Filter is applied client-side so the
  // dropdown options reflect the full set of callers in view.
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const tick = async () => {
      // Skip the fetch while the tab is backgrounded (mirrors
      // useHealthPolling / useAgentPolling) so a hidden window does no work.
      if (!document.hidden) {
        try {
          const next = await listTraces(limit);
          if (!cancelled) setLive(next);
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
    <aside aria-label="LLM call log" className="trace-feed">
      <div className="trace-feed-header" role="tablist" aria-label="Trace view">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "calls"}
          onClick={() => setTab("calls")}
          className={`trace-feed-tab${tab === "calls" ? " active" : ""}`}
        >
          llm calls
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "runs"}
          onClick={() => setTab("runs")}
          className={`trace-feed-tab${tab === "runs" ? " active" : ""}`}
        >
          runs
        </button>
        {tab === "calls" && (
          <>
            <select
              aria-label="Filter trace caller"
              value={filter}
              onChange={onFilterChange}
              className="trace-feed-filter"
            >
              <option value={ALL}>all ({allItems.length})</option>
              {callers.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <span>{visible.length}</span>
          </>
        )}
      </div>
      {tab === "runs" && <RunFeed />}
      {tab === "calls" && (
      <div className="trace-feed-body">
        {visible.length === 0 && (
          <div className="trace-feed-empty">
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
            className="trace-item"
          >
            <div className={`trace-item-meta${t.error ? " error" : ""}`}>
              <span>{new Date(t.timestamp).toLocaleTimeString()}</span>
              <span>·</span>
              <span className="trace-item-caller">{t.caller || "—"}</span>
              <span>·</span>
              <span>{t.model}</span>
              <span className="trace-item-dur">{t.duration_ms}ms</span>
            </div>
            <div className="trace-item-preview">
              {t.error ? `⚠ ${t.error}` : t.response_preview}
            </div>
          </button>
        ))}
        <button
          type="button"
          onClick={() => void loadOlder()}
          disabled={loadingOlder || dateExhausted.current}
          className="trace-feed-more"
        >
          {loadingOlder
            ? "loading…"
            : dateExhausted.current
              ? "no older traces"
              : "load older"}
        </button>
      </div>
      )}
      {tab === "calls" && openId && (
        <TraceModal traceId={openId} onClose={() => setOpenId(null)} />
      )}
    </aside>
  );
}
