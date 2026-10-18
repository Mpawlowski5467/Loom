import { Undo2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { describeApiError } from "@/api/client";
import {
  listHistory,
  notePath,
  revertCommit,
  type HistoryEntry,
} from "@/api/history";
import { AgentAvatar } from "@/components/AgentAvatar";
import { ConfirmModal } from "@/components/ConfirmModal";
import { Button } from "@/components/ui/button";
import { useApp } from "@/context/app-ctx";
import { actorLabel } from "@/data/actors";
import { formatRelative } from "@/data/formatDate";
import type { Note } from "@/data/types";

const LIMIT = 5;

interface RecentCommitsProps {
  note: Note;
  /** Undo waits for a clean draft. */
  disabled: boolean;
}

/** The note's last few commits, each with Undo (a new revert commit). */
export function RecentCommits({ note, disabled }: RecentCommitsProps) {
  const { reloadNoteBody, pushToast } = useApp();
  const path = notePath(note.folder, note.filename ?? `${note.id}.md`);
  const key = `${path}@${note.modified}`;
  const [state, setState] = useState<{
    key: string;
    items: HistoryEntry[];
    message: string;
  } | null>(null);
  const [confirm, setConfirm] = useState<HistoryEntry | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    listHistory({ path, limit: LIMIT }).then(
      (items) =>
        active &&
        setState({
          key,
          items,
          message: items.length ? "" : "No commits for this note yet.",
        }),
      (err: unknown) =>
        active &&
        setState({
          key,
          items: [],
          message: describeApiError(err, "Could not load history"),
        }),
    );
    return () => {
      active = false;
    };
  }, [path, key, reload]);

  const undo = useCallback(
    async (entry: HistoryEntry) => {
      const result = await revertCommit(entry.sha);
      pushToast({
        icon: "↺",
        agent: "sentinel",
        body: `Undone in ${result.sha?.slice(0, 7) ?? "a new commit"} (Sentinel ${result.sentinel.status}).`,
      });
      setReload((n) => n + 1);
      void reloadNoteBody?.(note.id);
    },
    [note.id, pushToast, reloadNoteBody],
  );

  const current = state?.key === key ? state : null;
  return (
    <section
      aria-labelledby="graph-note-history"
      className="flex flex-col gap-2"
    >
      <h3
        id="graph-note-history"
        className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase"
      >
        History
      </h3>
      {!current ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading history…
        </p>
      ) : current.message ? (
        <p className="text-sm text-muted-foreground">{current.message}</p>
      ) : (
        <ol className="flex flex-col">
          {current.items.map((item) => (
            <li
              key={item.sha}
              className="flex items-center gap-2 rounded-md px-1 py-1 text-sm"
            >
              <AgentAvatar actor={item.agents[0] ?? item.author} />
              <span className="min-w-0 flex-1 truncate text-secondary-foreground">
                <span className="font-medium text-foreground">
                  {item.agents.map(actorLabel).join(", ") || item.author}
                </span>{" "}
                {item.action || item.subject}
              </span>
              <span
                className="font-mono text-[11px] whitespace-nowrap text-muted-foreground"
                title={new Date(item.date).toLocaleString()}
              >
                {item.short_sha} · {formatRelative(item.date)}
              </span>
              {item.revertible && (
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={disabled}
                  title={
                    disabled ? "Save or discard your edits first" : undefined
                  }
                  aria-label={`Undo ${item.short_sha}`}
                  onClick={() => setConfirm(item)}
                >
                  <Undo2 aria-hidden="true" />
                  Undo
                </Button>
              )}
            </li>
          ))}
        </ol>
      )}
      {confirm && (
        <ConfirmModal
          title="Undo this change?"
          body="Loom adds a new commit that reverses it; nothing is erased from history. Sentinel checks the result first, and newer overlapping edits block the undo."
          confirmLabel="Undo change"
          destructive={false}
          onClose={() => setConfirm(null)}
          onConfirm={() => undo(confirm)}
        />
      )}
    </section>
  );
}
