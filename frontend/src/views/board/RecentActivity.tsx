import { useState, type ReactNode } from "react";
import { revertCommit } from "../../api/history";
import { ConfirmModal } from "../../components/ConfirmModal";
import type { AgentEvent } from "../../data/types";
import { formatRelativeTime, renderTarget } from "./boardHelpers";

interface RecentActivityProps {
  changelog: AgentEvent[];
}

/** The board's cross-agent changelog list (15 most recent events). */
export function RecentActivity({ changelog }: RecentActivityProps): ReactNode {
  const [pending, setPending] = useState<AgentEvent | null>(null);
  const [undone, setUndone] = useState<Record<string, string>>({});
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
          {ev.commit &&
            (ev.reverted || undone[ev.commit] ? (
              <span className="changelog-undone" role="status">
                undone
              </span>
            ) : (
              <button
                className="btn btn-sm changelog-undo"
                title={`Revert commit ${ev.commit.slice(0, 10)}`}
                aria-label={`Undo ${ev.agent} ${ev.action} ${ev.target}`}
                onClick={() => setPending(ev)}
              >
                Undo
              </button>
            ))}
        </div>
      ))}
      {pending?.commit && (
        <ConfirmModal
          title="Undo this agent action?"
          body={`Loom adds a commit that reverses ${pending.agent}'s "${pending.action}" (commit ${pending.commit.slice(0, 10)}) and every file it changed in the same run. Nothing is erased from history; Sentinel checks the result, and newer overlapping edits block the undo.`}
          confirmLabel="Undo action"
          onClose={() => setPending(null)}
          onConfirm={async () => {
            const sha = pending.commit as string;
            const result = await revertCommit(sha);
            setUndone((prev) => ({ ...prev, [sha]: result.sha ?? "" }));
          }}
        />
      )}
    </div>
  );
}
