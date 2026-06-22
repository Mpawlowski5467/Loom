import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ArchiveRestore, FileText } from "lucide-react";
import {
  listArchivedNotes,
  restoreArchivedNote,
  type ArchivedNoteRecord,
} from "../../api/archive";
import { formatDate } from "../../data/formatDate";

/**
 * Archived / Trash surface: lists notes that were archived (moved under
 * ``threads/.archive/``) and restores them to their original folder. Loom
 * never hard-deletes a note, so this is the in-app path back — no more moving
 * files by hand. A restore that collides with an active note at the original
 * path surfaces the backend's 409 message inline.
 */
export function ArchivedSection(): ReactNode {
  const [notes, setNotes] = useState<ArchivedNoteRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    const result = await listArchivedNotes();
    setNotes(result.notes);
  };

  useEffect(() => {
    void load()
      .catch((err) => {
        setMessage(err instanceof Error ? err.message : "Failed to load archive");
      })
      .finally(() => setLoaded(true));
  }, []);

  const restore = async (note: ArchivedNoteRecord) => {
    setBusyId(note.id);
    setMessage(null);
    try {
      await restoreArchivedNote(note.id);
      await load();
      setMessage(`Restored "${note.title}" to ${note.original_path}.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="settings-panel">
      <div className="settings-kicker">Vault</div>
      <h1 className="settings-title">Archived</h1>
      <p className="settings-copy">
        Archived notes are kept under <code>threads/.archive/</code> — never
        deleted. Restore one to move it back to its original folder and the
        graph.
      </p>

      {loaded && notes.length === 0 ? (
        <div className="settings-inline-status">No archived notes.</div>
      ) : (
        <div className="settings-vault-list">
          {notes.map((note) => (
            <article key={note.id} className="settings-vault-card">
              <div>
                <div className="settings-vault-name">
                  <FileText size={15} aria-hidden="true" />
                  {note.title || note.id}
                </div>
                <div className="settings-vault-path">
                  {note.original_path} · {note.type} · archived{" "}
                  {formatDate(note.archived_at)}
                </div>
              </div>
              <div className="settings-vault-actions">
                <button
                  className="btn btn-md"
                  type="button"
                  onClick={() => void restore(note)}
                  disabled={busyId !== null}
                >
                  <ArchiveRestore size={14} aria-hidden="true" />
                  Restore
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {message && <div className="settings-inline-status">{message}</div>}
    </div>
  );
}
