import { FileQuestion } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { ConfirmModal } from "@/components/ConfirmModal";
import { EmptyState } from "@/components/EmptyState";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useApp } from "@/context/app-ctx";
import { listDraftNoteIds } from "@/editor/noteDraftStorage";
import { NoteAnchorScroll } from "@/editor/NoteAnchorScroll";
import { ConflictBanner } from "./ConflictBanner";
import { HistorySheet } from "./HistorySheet";
import { NoteProperties } from "./NoteProperties";
import { NoteTitle } from "./NoteTitle";
import { NoteTopBar } from "./NoteTopBar";
import { ContextRail } from "./rail/ContextRail";
import { SourceEditor } from "./SourceEditor";
import { SuggestionCards } from "./SuggestionCards";
import { SupersessionBanner } from "./SupersessionBanner";
import { useNoteActions } from "./useNoteActions";
import { useNoteDraft } from "./useNoteDraft";
import { useNoteSuggestions } from "./useNoteSuggestions";
import { VaultTree } from "./VaultTree";

const RichEditor = lazy(() =>
  import("@/editor/plate/RichEditor").then((m) => ({ default: m.RichEditor })),
);

const SOURCE_MODE_KEY = "loom.notes.sourceMode";

function readSourceMode(): boolean {
  try {
    return localStorage.getItem(SOURCE_MODE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Notes: vault tree | note (top bar, banner, title, properties, editor,
 * suggestions) | context rail. Side panels move into sheets below 1024px.
 */
export function NotesView() {
  const app = useApp();
  const { currentNoteId, noteById, notes, config, extraFolders } = app;
  const note = currentNoteId ? (noteById(currentNoteId) ?? null) : null;
  const vaultId = config?.active_vault ?? "default";
  const draft = useNoteDraft({
    note,
    vaultId,
    notes,
    updateNote: app.updateNote,
    pushToast: app.pushToast,
  });
  const actions = useNoteActions(note);
  const suggestions = useNoteSuggestions(note);
  const [sourceMode, setSourceMode] = useState(readSourceMode);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [treeOpen, setTreeOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [archiveBase, setArchiveBase] = useState<string | null>(null);
  const draftIds = useMemo(
    () => listDraftNoteIds(vaultId),
    // Recompute when this note's draft starts or stops differing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vaultId, draft.dirty, currentNoteId],
  );

  const { save } = draft;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const toggleSource = (on: boolean) => {
    setSourceMode(on);
    try {
      localStorage.setItem(SOURCE_MODE_KEY, on ? "1" : "0");
    } catch {
      // Preference just won't persist.
    }
  };

  const tree = (
    <VaultTree
      notes={notes}
      extraFolders={extraFolders}
      currentNoteId={currentNoteId}
      draftIds={draftIds}
      onNavigate={() => setTreeOpen(false)}
    />
  );

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-sidebar lg:flex">
        {tree}
      </aside>
      <Sheet open={treeOpen} onOpenChange={setTreeOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetTitle className="sr-only">Vault</SheetTitle>
          {tree}
        </SheetContent>
      </Sheet>

      <section aria-label="Note" className="flex min-w-0 flex-1 flex-col">
        {!note ? (
          <NoNote
            loaded={app.notesLoaded}
            onOpenTree={() => setTreeOpen(true)}
          />
        ) : (
          <>
            <NoteTopBar
              note={note}
              dirty={draft.dirty}
              saving={draft.saving}
              sourceMode={sourceMode}
              onSourceModeChange={toggleSource}
              onSave={() => void draft.save()}
              onHistory={() => setHistoryOpen(true)}
              onAskCouncil={() => {
                app.setCouncilPrefill(`About [[${note.title}]]: `);
                app.setTab("board");
              }}
              onArchive={() =>
                setArchiveBase(note.contentVersion ?? note.modified)
              }
              onOpenTree={() => setTreeOpen(true)}
              onOpenRail={() => setRailOpen(true)}
            />
            <div className="min-h-0 flex-1 overflow-y-auto">
              <article className="mx-auto w-full max-w-[720px] px-6 pt-8 pb-24">
                {draft.bodyLoaded && <NoteAnchorScroll />}
                <SupersessionBanner note={note} />
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
                  <Alert variant="warning" className="mb-6">
                    <AlertDescription className="text-warning-foreground">
                      This browser can't keep a local copy of your draft. Save
                      before you leave this note.
                    </AlertDescription>
                  </Alert>
                )}
                <NoteTitle note={note} onRename={actions.rename} />
                <div className="mt-4">
                  <NoteProperties note={note} onTagsChange={actions.setTags} />
                </div>
                <NoteBody note={note} draft={draft} sourceMode={sourceMode} />
                {draft.dirty && (
                  <div className="mt-4 flex justify-end">
                    <Button variant="ghost" size="sm" onClick={draft.discard}>
                      Discard changes
                    </Button>
                  </div>
                )}
                <SuggestionCards
                  suggestions={suggestions.suggestions}
                  disabled={draft.dirty}
                  onLink={(s) => void suggestions.link(s)}
                  onDismiss={(s) => void suggestions.dismiss(s)}
                />
              </article>
            </div>
          </>
        )}
      </section>

      {note && (
        <>
          <aside
            aria-label="Note context"
            className="hidden w-80 shrink-0 overflow-y-auto border-l border-border bg-sidebar lg:block"
          >
            <ContextRail note={note} />
          </aside>
          <Sheet open={railOpen} onOpenChange={setRailOpen}>
            <SheetContent side="right" className="w-80 overflow-y-auto p-0">
              <SheetTitle className="sr-only">Note context</SheetTitle>
              <ContextRail note={note} />
            </SheetContent>
          </Sheet>
          <HistorySheet
            note={note}
            vaultId={vaultId}
            open={historyOpen}
            onOpenChange={setHistoryOpen}
            disabled={draft.dirty || !draft.bodyLoaded}
          />
          {archiveBase && (
            <ConfirmModal
              title={`Archive "${note.title}"?`}
              body="It moves to threads/.archive/ and leaves the active graph. You can restore it from there."
              confirmLabel="Archive"
              destructive
              onConfirm={() => actions.archive(archiveBase)}
              onClose={() => setArchiveBase(null)}
            />
          )}
        </>
      )}
    </div>
  );
}

function NoNote({
  loaded,
  onOpenTree,
}: {
  loaded: boolean;
  onOpenTree: () => void;
}) {
  if (!loaded)
    return (
      <div
        className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-6 pt-12"
        aria-label="Loading note"
      >
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    );
  return (
    <EmptyState
      icon={<FileQuestion />}
      title="Note not found"
      description="It may have been renamed or archived. Pick a note from the vault."
      action={
        <Button
          variant="outline"
          size="sm"
          className="lg:hidden"
          onClick={onOpenTree}
        >
          Browse notes
        </Button>
      }
    />
  );
}

function NoteBody({
  note,
  draft,
  sourceMode,
}: {
  note: NonNullable<ReturnType<ReturnType<typeof useApp>["noteById"]>>;
  draft: ReturnType<typeof useNoteDraft>;
  sourceMode: boolean;
}) {
  const { notes, reloadNoteBody } = useApp();
  if (!draft.bodyLoaded)
    return note.bodyError ? (
      <Alert variant="warning">
        <AlertDescription className="text-warning-foreground">
          <p>Could not load this note: {note.bodyError}</p>
          {reloadNoteBody && (
            <Button
              size="xs"
              variant="outline"
              className="mt-2"
              onClick={() => void reloadNoteBody(note.id)}
            >
              Retry
            </Button>
          )}
        </AlertDescription>
      </Alert>
    ) : (
      <div
        className="flex flex-col gap-3"
        role="status"
        aria-label="Loading note"
      >
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    );
  if (sourceMode)
    return (
      <SourceEditor
        key={`${note.id}:${draft.revision}`}
        value={draft.draft}
        notes={notes}
        onChange={draft.setDraft}
      />
    );
  return (
    <Suspense fallback={<Skeleton className="h-40 w-full" />}>
      <RichEditor
        key={`${note.id}:${draft.revision}`}
        noteId={note.id}
        markdown={draft.draft}
        onChange={draft.setDraft}
      />
    </Suspense>
  );
}
