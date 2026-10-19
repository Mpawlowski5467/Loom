import { useCallback, useEffect, useState } from "react";
import {
  getHistoryStatus,
  listHistory,
  notePath,
  type HistoryEntry,
} from "../api/history";
import { describeApiError } from "../api/client";
import { useApp } from "../context/app-ctx";
import { formatRelative } from "../data/formatDate";
import { actorLabel } from "../data/actors";
import { AgentAvatar } from "./AgentAvatar";
import { CommitDetail } from "./CommitDetail";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

interface NoteHistoryProps {
  noteId: string;
  folder: string;
  filename?: string;
  disabled?: boolean;
  /** Render the list immediately (inside a sheet) instead of behind a toggle. */
  alwaysOpen?: boolean;
}

async function fetchNoteHistory(
  path: string,
): Promise<{ items: HistoryEntry[]; message: string }> {
  const status = await getHistoryStatus();
  if (!status.enabled) return { items: [], message: status.reason };
  const items = await listHistory({ path, limit: 50 });
  return {
    items,
    message: items.length ? "" : "No commits for this note yet.",
  };
}

/** Git-backed change history for one note, with per-commit diffs and undo. */
export function NoteHistory({
  noteId,
  folder,
  filename,
  disabled = false,
  alwaysOpen = false,
}: NoteHistoryProps) {
  const { config, reloadNoteBody } = useApp();
  const [toggled, setOpen] = useState(false);
  const open = alwaysOpen || toggled;
  const [items, setItems] = useState<HistoryEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const path = filename ? notePath(folder, filename) : "";

  const load = useCallback(
    (isCancelled: () => boolean = () => false) =>
      fetchNoteHistory(path).then(
        (result) => {
          if (isCancelled()) return;
          setItems(result.items);
          setMessage(result.message);
        },
        (err: unknown) => {
          if (!isCancelled())
            setMessage(describeApiError(err, "Could not load history"));
        },
      ),
    [path],
  );

  useEffect(() => {
    if (!open || !path) return;
    let cancelled = false;
    void load(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [open, path, load, config?.active_vault]);

  if (!path) return null;
  return (
    <section className="flex flex-col gap-3">
      {!alwaysOpen && (
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          Change history
        </Button>
      )}
      {open && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Every agent and human change to this note is a commit. Undo adds a
            new commit; history is never rewritten.
          </p>
          {message && (
            <p role="status" className="text-sm text-muted-foreground">
              {message}
            </p>
          )}
          <ol className="flex flex-col gap-1">
            {items.map((item) => (
              <li key={item.sha}>
                <button
                  type="button"
                  aria-pressed={selected === item.sha}
                  onClick={() =>
                    setSelected(selected === item.sha ? null : item.sha)
                  }
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    selected === item.sha && "bg-accent",
                  )}
                >
                  <AgentAvatar actor={item.agents[0] ?? item.author} />
                  <span className="min-w-0 flex-1 truncate text-secondary-foreground">
                    <span className="font-medium text-foreground">
                      {item.agents.map(actorLabel).join(", ") || item.author}
                    </span>{" "}
                    {item.action || item.subject}
                  </span>
                  {item.sentinel && (
                    <span className="hidden text-xs text-muted-foreground sm:inline">
                      Sentinel {item.sentinel.split(" ")[0]}
                    </span>
                  )}
                  <span
                    className="font-mono text-[11px] whitespace-nowrap text-muted-foreground"
                    title={new Date(item.date).toLocaleString()}
                  >
                    {item.short_sha} · {formatRelative(item.date)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {selected && (
            <CommitDetail
              key={selected}
              sha={selected}
              disabled={disabled}
              onReverted={() => {
                void load();
                void reloadNoteBody?.(noteId);
              }}
            />
          )}
        </div>
      )}
    </section>
  );
}
