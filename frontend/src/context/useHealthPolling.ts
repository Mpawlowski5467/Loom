import { useState, useEffect } from "react";
import { getHealth } from "../api/diagnostics";

const HEALTH_INTERVAL_MS = 8000;

/**
 * Poll ``/api/health`` on a slow interval (8s) while ``enabled``, surfacing the
 * indexer's ``unindexed`` drift count — notes that are in the file index but
 * missing from the search vector store (e.g. an embedding blip). The caller
 * enables this only when the app is online, onboarded, and not in demo mode.
 *
 * Fetches are skipped while the browser tab is hidden, mirroring
 * {@link useAgentPolling}, so a backgrounded window does no network work.
 * Best-effort: a cold/unreachable backend leaves the count at 0.
 */
export function useHealthPolling(enabled: boolean): number {
  const [unindexedCount, setUnindexedCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: number | null = null;

    const poll = async () => {
      if (!document.hidden) {
        try {
          const health = await getHealth();
          if (cancelled) return;
          const n = health.components?.indexer?.unindexed ?? 0;
          setUnindexedCount(Number.isFinite(n) ? n : 0);
        } catch {
          // best-effort; backend may be cold during dev restarts
        }
      }
      if (!cancelled) {
        timer = window.setTimeout(poll, HEALTH_INTERVAL_MS);
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [enabled]);

  return unindexedCount;
}
