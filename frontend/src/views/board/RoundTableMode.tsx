import type { ReactNode } from "react";
import { useApp } from "../../context/app-ctx";

const BUBBLES: Record<string, string> = {
  weaver: "I created a capture file for your morning notes — pending your accept.",
  spider: "Linked Webhooks → Webhook retries (high confidence).",
  archivist: "Nothing to archive. Captures pile has 5 unprocessed items.",
  scribe: "Summary queue: 2 notes over the threshold.",
  sentinel: "3 edits validated clean. One duplicate-title warning.",
  researcher: "Drafted a capture on Sigma 3 reducers.",
  standup: "Daily recap written to daily/2026-05-16.",
};

export function RoundTableMode(): ReactNode {
  const { agents } = useApp();

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
                {a.icon}
              </div>
              <div className="rt-name">{a.name}</div>
              <div className="rt-bubble">{BUBBLES[a.id] ?? a.lastAction}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
