import type { ReactNode } from "react";
import type { AgentEvent } from "../../data/types";
import { formatRelativeTime, renderTarget } from "./boardHelpers";

interface RecentActivityProps {
  changelog: AgentEvent[];
}

/** The board's cross-agent changelog list (15 most recent events). */
export function RecentActivity({ changelog }: RecentActivityProps): ReactNode {
  return (
    <div className="changelog">
      {changelog.length === 0 && (
        <div className="changelog-empty">
          No agent activity yet. Process a capture or send a council message.
        </div>
      )}
      {changelog.slice(0, 15).map((ev) => (
        <div key={ev.id} className="changelog-row" title={ev.ts}>
          <span className="changelog-ts">{formatRelativeTime(ev.ts)}</span>
          <span className="changelog-agent">{ev.agent}</span>
          <span>
            {ev.action} {renderTarget(ev.target)}
          </span>
          <span className={`changelog-verdict ${ev.sentinel}`}>
            {ev.sentinel === "ok" ? "✓" : ev.sentinel === "warn" ? "⚠" : "✕"}
          </span>
        </div>
      ))}
    </div>
  );
}
