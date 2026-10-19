import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
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

/** The SQLite revision journal for one note: inspect a write, restore before it. */
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
    <section className="flex flex-col gap-3 text-sm">
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Version history
      </Button>
      {open && (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
          <p className="text-muted-foreground">
            Revisions record vault writes from this update onward. Save or
            discard your draft before restoring a version.
          </p>
          {error && (
            <p role="alert" className="text-danger-foreground">
              {error}
            </p>
          )}
          {!items.length && !error && (
            <p className="text-muted-foreground">No recorded revisions yet.</p>
          )}
          <div className="flex max-h-40 flex-wrap gap-2 overflow-auto">
            {items.map((item) => (
              <Button
                variant="outline"
                size="xs"
                className="font-mono"
                key={item.id}
                disabled={loading}
                onClick={() => void inspect(item.id)}
              >
                {new Date(item.created).toLocaleString()} · {item.caller}
              </Button>
            ))}
          </div>
          {loading && (
            <p role="status" className="text-muted-foreground">
              Loading revision…
            </p>
          )}
          {detail && (
            <div className="flex flex-col gap-3">
              {Object.keys(detail.after).map((path) => (
                <section key={path} className="flex flex-col gap-1.5">
                  <h4 className="font-mono text-xs text-muted-foreground">
                    {path}
                  </h4>
                  <TextDiff
                    before={detail.before[path] ?? ""}
                    after={detail.after[path] ?? ""}
                  />
                </section>
              ))}
              {Object.values(detail.before).some(Boolean) && (
                <Button
                  variant="outline"
                  size="sm"
                  className="self-start"
                  disabled={disabled}
                  onClick={() => setConfirm(true)}
                >
                  Restore version before this change
                </Button>
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
