import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useApp } from "../../context/app-ctx";
import { AgentBlob } from "../../components/primitives/AgentBlob";
import { getAgentBubble } from "../../api/agentsRegistry";

const FALLBACK_BUBBLES: Record<string, string> = {
  weaver: "I created a capture file for your morning notes — pending your accept.",
  spider: "Linked Webhooks → Webhook retries (high confidence).",
  archivist: "Nothing to archive. Captures pile has 5 unprocessed items.",
  scribe: "Summary queue: 2 notes over the threshold.",
  sentinel: "3 edits validated clean. One duplicate-title warning.",
  researcher: "Drafted a capture on Sigma 3 reducers.",
  standup: "Daily recap written to daily.",
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_KEY = "loom.roundTableBubbles";

interface CacheEntry {
  bubble: string;
  fetchedAt: number;
}

function loadCache(): Record<string, CacheEntry> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, CacheEntry>;
  } catch {
    return {};
  }
}

function saveCache(cache: Record<string, CacheEntry>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // ignore quota / serialization failures
  }
}

export function RoundTableMode(): ReactNode {
  const { agents } = useApp();
  const [bubbles, setBubbles] = useState<Record<string, string>>(() => {
    const cache = loadCache();
    const now = Date.now();
    const out: Record<string, string> = {};
    for (const [id, entry] of Object.entries(cache)) {
      if (now - entry.fetchedAt < CACHE_TTL_MS) out[id] = entry.bubble;
    }
    return out;
  });

  useEffect(() => {
    const cache = loadCache();
    const now = Date.now();
    const stale = agents.filter((a) => {
      const entry = cache[a.id];
      return !entry || now - entry.fetchedAt >= CACHE_TTL_MS;
    });
    if (stale.length === 0) return;

    let cancelled = false;
    void Promise.allSettled(
      stale.map((a) => getAgentBubble(a.id).then((res) => ({ a, res }))),
    ).then((results) => {
      if (cancelled) return;
      const nextCache = loadCache();
      const ts = Date.now();
      const patch: Record<string, string> = {};
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        const { a, res } = r.value;
        nextCache[a.id] = { bubble: res.bubble, fetchedAt: ts };
        patch[a.id] = res.bubble;
      }
      saveCache(nextCache);
      if (Object.keys(patch).length > 0) {
        setBubbles((prev) => ({ ...prev, ...patch }));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [agents]);

  return (
    <div className="round-table-mode">
      <div className="rt-stage">
        <div className="rt-table" />
        <div className="rt-question">
          <div className="label">your question</div>
          <div className="q">what's the state of my vault?</div>
        </div>
        {agents.map((a, i) => {
          const theta = (i / agents.length) * Math.PI * 2 - Math.PI / 2;
          const rx = 38; // %
          const ry = 30; // %
          const left = 50 + Math.cos(theta) * rx;
          const top = 50 + Math.sin(theta) * ry;
          const bubble =
            bubbles[a.id] ?? FALLBACK_BUBBLES[a.id] ?? a.lastAction;
          return (
            <div
              key={a.id}
              className="rt-seat"
              style={{ left: `${left}%`, top: `${top}%` }}
            >
              <div
                className="rt-icon"
                style={{ animationDelay: `${-i * 0.5}s` }}
                aria-hidden="true"
              >
                <AgentBlob agent={a.id} state={a.state} size={52} />
              </div>
              <div className="rt-name">{a.name}</div>
              <div className="rt-bubble">{bubble}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
