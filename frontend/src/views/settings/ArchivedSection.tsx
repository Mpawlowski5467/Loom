import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ArchiveRestore, FileText } from "lucide-react";
import {
  listArchivedNotes,
  restoreArchivedNote,
  type ArchivedNoteRecord,
} from "@/api/archive";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/data/formatDate";
import { SettingsGroup } from "./kit/SettingsGroup";
import { StatusLine } from "./kit/StatusLine";
import { ListCard } from "./vault/ListCard";
import { describeApiError } from "@/api/client";

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
        setMessage(describeApiError(err, "Failed to load archive"));
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
      setMessage(describeApiError(err, "Restore failed"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <SettingsGroup
      title="Archived"
      description={
        <>
          Archived notes are kept under{" "}
          <code className="font-mono text-xs">threads/.archive/</code> — never
          deleted. Restore one to move it back to its original folder and the
          graph.
        </>
      }
    >
      {loaded && notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No archived notes.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {notes.map((note) => (
            <ListCard key={note.id}>
              <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
                <p className="flex items-center gap-2 font-medium text-foreground">
                  <FileText
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                  {note.title || note.id}
                </p>
                <p className="font-mono text-xs break-all text-muted-foreground">
                  {note.original_path} · {note.type} · archived{" "}
                  {formatDate(note.archived_at)}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void restore(note)}
                disabled={busyId !== null}
              >
                <ArchiveRestore aria-hidden="true" />
                Restore
              </Button>
            </ListCard>
          ))}
        </div>
      )}
      {message && <StatusLine>{message}</StatusLine>}
    </SettingsGroup>
  );
}
