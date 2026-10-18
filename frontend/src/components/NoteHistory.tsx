import { useCallback, useEffect, useState } from "react";
import {
  getHistoryStatus,
  listHistory,
  notePath,
  type HistoryEntry,
} from "../api/history";
import { useApp } from "../context/app-ctx";
import { CommitDetail } from "./CommitDetail";
import "../styles/components/revisions.css";

interface NoteHistoryProps {
  noteId: string;
  folder: string;
  filename?: string;
  disabled?: boolean;
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
}: NoteHistoryProps) {
  const { config, reloadNoteBody } = useApp();
  const [open, setOpen] = useState(false);
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
            setMessage(
              err instanceof Error ? err.message : "Could not load history",
            );
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
    <section className="revision-history note-history">
      <button
        className="btn btn-sm"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Change history
      </button>
      {open && (
        <div className="revision-panel">
          <p>
            Every agent and human change to this note is a commit. Undo adds a
            new commit; history is never rewritten.
          </p>
          {message && <p role="status">{message}</p>}
          <ol className="history-list">
            {items.map((item) => (
              <li key={item.sha}>
                <button
                  className={`btn btn-sm history-entry${selected === item.sha ? " active" : ""}`}
                  aria-pressed={selected === item.sha}
                  onClick={() =>
                    setSelected(selected === item.sha ? null : item.sha)
                  }
                >
                  <span className="history-date">
                    {new Date(item.date).toLocaleString()}
                  </span>
                  <span className="history-who">{item.agents.join(", ")}</span>
                  <span>{item.action || item.subject}</span>
                  {item.sentinel && (
                    <span className="history-sentinel">
                      Sentinel {item.sentinel.split(" ")[0]}
                    </span>
                  )}
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
