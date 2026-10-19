import { GitCommitHorizontal, Undo2 } from "lucide-react";
import { useState } from "react";
import { revertCommit } from "@/api/history";
import { AgentAvatar } from "@/components/AgentAvatar";
import { ConfirmModal } from "@/components/ConfirmModal";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { actorLabel } from "@/data/actors";
import type { AgentEvent, SentinelVerdict } from "@/data/types";
import { cn } from "@/lib/utils";
import { formatRelativeTime, renderTarget } from "./boardHelpers";

const PAGE = 15;

const VERDICT: Record<SentinelVerdict, { label: string; className: string }> = {
  ok: {
    label: "passed",
    className: "border-ok/40 text-ok-foreground bg-ok/10",
  },
  warn: {
    label: "warning",
    className: "border-warning-border text-warning-foreground bg-warning",
  },
  fail: {
    label: "needs review",
    className: "border-danger-foreground/40 text-danger-foreground",
  },
};

function SentinelBadge({ verdict }: { verdict: SentinelVerdict }) {
  const v = VERDICT[verdict];
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium",
        v.className,
      )}
    >
      {v.label}
    </span>
  );
}

/** Recent agent actions; each row is a git commit that can be undone. */
export function ActivityLog({ events }: { events: readonly AgentEvent[] }) {
  const [limit, setLimit] = useState(PAGE);
  const [pending, setPending] = useState<AgentEvent | null>(null);
  const [undone, setUndone] = useState<ReadonlySet<string>>(new Set());
  return (
    <section aria-labelledby="board-activity" className="flex flex-col gap-3">
      <header className="flex items-baseline gap-2">
        <h2 id="board-activity" className="text-sm font-medium text-foreground">
          Activity
        </h2>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <GitCommitHorizontal aria-hidden="true" className="size-3.5" />
          Each row is a git commit in your vault.
        </p>
      </header>
      {events.length === 0 ? (
        <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
          No agent activity yet. Process a capture or ask the Council something.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Time</TableHead>
                <TableHead className="w-32">Agent</TableHead>
                <TableHead>Action</TableHead>
                <TableHead className="w-32">Sentinel</TableHead>
                <TableHead className="w-24 text-right">
                  <span className="sr-only">Undo</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.slice(0, limit).map((ev) => {
                const isUndone =
                  ev.reverted || (ev.commit && undone.has(ev.commit));
                return (
                  <TableRow key={ev.id}>
                    <TableCell
                      className="font-mono text-xs text-muted-foreground"
                      title={ev.ts}
                    >
                      {formatRelativeTime(ev.ts)}
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2 text-sm">
                        <AgentAvatar actor={ev.agent} />
                        {actorLabel(ev.agent)}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-0 truncate text-sm text-secondary-foreground">
                      {ev.action} {renderTarget(ev.target)}
                    </TableCell>
                    <TableCell>
                      <SentinelBadge verdict={ev.sentinel} />
                    </TableCell>
                    <TableCell className="text-right">
                      {ev.commit &&
                        (isUndone ? (
                          <span className="text-xs text-muted-foreground">
                            Undone
                          </span>
                        ) : (
                          <Button
                            variant="ghost"
                            size="xs"
                            title={`Revert commit ${ev.commit.slice(0, 10)}`}
                            aria-label={`Undo ${ev.agent} ${ev.action} ${ev.target}`}
                            onClick={() => setPending(ev)}
                          >
                            <Undo2 aria-hidden="true" />
                            Undo
                          </Button>
                        ))}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {events.length > limit && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => setLimit((n) => n + PAGE)}
        >
          Show more
        </Button>
      )}
      {pending?.commit && (
        <ConfirmModal
          title="Undo this agent action?"
          body={`Loom adds a commit that reverses ${pending.agent}'s "${pending.action}" (commit ${pending.commit.slice(0, 10)}) and every file it changed in the same run. Nothing is erased from history; Sentinel checks the result, and newer overlapping edits block the undo.`}
          confirmLabel="Undo action"
          destructive={false}
          onClose={() => setPending(null)}
          onConfirm={async () => {
            const sha = pending.commit as string;
            await revertCommit(sha);
            setUndone((prev) => new Set(prev).add(sha));
          }}
        />
      )}
    </section>
  );
}
