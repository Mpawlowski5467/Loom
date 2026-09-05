import { useEffect, useState } from "react";
import {
  getRevision,
  listRevisions,
  restoreRevision,
  type RevisionDetail,
  type RevisionSummary,
} from "../api/revisions";
import { backendNoteToFrontend, titleMapFromNotes } from "../api/notes";
import { useApp } from "../context/app-ctx";
import { ConfirmModal } from "./ConfirmModal";
import { TextDiff } from "./TextDiff";
import { RunUndo } from "./RunUndo";

export function RevisionHistory({
  noteId,
  disabled = false,
}: {
  noteId: string;
  disabled?: boolean;
}) {
  const { notes, updateNote, config } = useApp();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<RevisionSummary[]>([]);
  const [detail, setDetail] = useState<RevisionDetail | null>(null);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void listRevisions(noteId)
      .then((data) => {
        if (!cancelled) setItems(data);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : "Could not load revisions",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [noteId, open, config?.active_vault]);
  const inspect = async (id: string) => {
    setLoading(true);
    setError("");
    setDetail(null);
    try {
      setDetail(await getRevision(id, noteId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load revision");
    } finally {
      setLoading(false);
    }
  };
  return (
    <section className="revision-history">
      <button
        className="btn btn-sm"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Version history
      </button>
      {open && (
        <div className="revision-panel">
          <p>
            Revisions record vault writes from this update onward. Save or
            discard your draft before restoring a version.
          </p>
          {error && <p role="alert">{error}</p>}
          {!items.length && !error && <p>No recorded revisions yet.</p>}
          <div className="revision-list">
            {items.map((item) => (
              <button
                className="btn btn-sm"
                key={item.id}
                disabled={loading}
                onClick={() => void inspect(item.id)}
              >
                {new Date(item.created).toLocaleString()} · {item.caller}
              </button>
            ))}
          </div>
          {loading && <p role="status">Loading revision…</p>}
          {detail && (
            <div>
              {Object.keys(detail.after).map((path) => (
                <section key={path}>
                  <h4>{path}</h4>
                  <TextDiff
                    before={detail.before[path] ?? ""}
                    after={detail.after[path] ?? ""}
                  />
                </section>
              ))}
              {Object.values(detail.before).some(Boolean) && (
                <button
                  className="btn btn-sm"
                  disabled={disabled}
                  onClick={() => setConfirm(true)}
                >
                  Restore version before this change
                </button>
              )}
              {detail.run_id && (
                <RunUndo runId={detail.run_id} disabled={disabled} />
              )}
            </div>
          )}
        </div>
      )}
      {confirm && detail && (
        <ConfirmModal
          title="Restore this version?"
          body="The selected earlier content and metadata will replace the current note. The current version stays in history. A newer edit will block the restore."
          confirmLabel="Restore version"
          onClose={() => setConfirm(false)}
          onConfirm={async () => {
            const record = await restoreRevision(
              detail.id,
              noteId,
              detail.current_hash,
            );
            updateNote(backendNoteToFrontend(record, titleMapFromNotes(notes)));
            setDetail(null);
            setItems(await listRevisions(noteId));
          }}
        />
      )}
    </section>
  );
}
