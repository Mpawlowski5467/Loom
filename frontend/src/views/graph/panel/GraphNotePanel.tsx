import { Maximize2, Save, X } from "lucide-react";
import type { KeyboardEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useApp } from "@/context/app-ctx";
import { formatRelative } from "@/data/formatDate";
import type { Note } from "@/data/types";
import { ConflictBanner } from "@/views/notes/ConflictBanner";
import { NoteBody } from "@/views/notes/NoteBody";
import { useLastCommit } from "@/views/notes/useLastCommit";
import { useNoteDraft } from "@/views/notes/useNoteDraft";
import { ArchivistCard } from "./ArchivistCard";
import { RecentCommits } from "./RecentCommits";

interface GraphNotePanelProps {
  note: Note;
  onClose: () => void;
  /** Show another note in the panel (selects it in the graph). */
  onSelectNote: (id: string) => void;
}

/**
 * The selected note beside the graph: the Notes editor in a compact layout,
 * Archivist's warnings and the last few commits with Undo.
 */
export function GraphNotePanel({
  note,
  onClose,
  onSelectNote,
}: GraphNotePanelProps) {
  const app = useApp();
  const draft = useNoteDraft({
    note,
    vaultId: app.config?.active_vault ?? "default",
    notes: app.notes,
    updateNote: app.updateNote,
    pushToast: app.pushToast,
  });
  const commit = useLastCommit(note);
  const path = [note.folder, note.filename ?? `${note.id}.md`]
    .filter(Boolean)
    .join("/");

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void draft.save();
    } else if (e.key === "Escape" && !e.defaultPrevented && !draft.dirty) {
      onClose();
    }
  };

  return (
    <aside
      aria-label="Open note"
      onKeyDown={onKeyDown}
      className="flex min-h-0 w-full flex-col border-l border-border bg-background"
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <p
            className="truncate font-mono text-xs text-secondary-foreground"
            title={path}
          >
            {path}
          </p>
          <p className="font-mono text-[11px] text-muted-foreground">
            {commit
              ? `${commit.short_sha} · ${formatRelative(commit.date)}`
              : " "}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs"
          onClick={() => app.openNote(note.id)}
        >
          <Maximize2 aria-hidden="true" />
          Open full editor
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close note"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <article className="flex flex-col gap-4 px-5 pt-5 pb-8">
          <h2 className="font-editor text-xl font-semibold text-foreground">
            {note.title}
          </h2>
          {draft.conflict && (
            <ConflictBanner
              conflict={draft.conflict}
              draft={draft.draft}
              onKeep={draft.keepDraft}
              onReload={() => void draft.reloadRemote()}
              onOverwrite={() => draft.save(true)}
            />
          )}
          {draft.storageFailed && draft.dirty && (
            <Alert variant="warning">
              <AlertDescription className="text-warning-foreground">
                This browser can't keep a local copy of your draft. Save before
                you close the note.
              </AlertDescription>
            </Alert>
          )}
          <NoteBody note={note} draft={draft} sourceMode={false} compact />
          <ArchivistCard note={note} onSelectNote={onSelectNote} />
          <RecentCommits
            key={note.id}
            note={note}
            disabled={draft.dirty || !draft.bodyLoaded}
          />
        </article>
      </div>

      {draft.dirty && (
        <footer className="flex items-center justify-end gap-2 border-t border-border px-3 py-2">
          <Button variant="ghost" size="sm" onClick={draft.discard}>
            Discard
          </Button>
          <Button
            size="sm"
            onClick={() => void draft.save()}
            disabled={draft.saving}
            aria-keyshortcuts="Meta+S Control+S"
          >
            <Save aria-hidden="true" />
            {draft.saving ? "Saving…" : "Save"}
          </Button>
        </footer>
      )}
    </aside>
  );
}
