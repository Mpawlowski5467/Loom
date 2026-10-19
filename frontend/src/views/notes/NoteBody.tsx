import { lazy, Suspense } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useApp } from "@/context/app-ctx";
import type { Note } from "@/data/types";
import { SourceEditor } from "./SourceEditor";
import type { useNoteDraft } from "./useNoteDraft";

const RichEditor = lazy(() =>
  import("@/editor/plate/RichEditor").then((m) => ({ default: m.RichEditor })),
);

interface NoteBodyProps {
  note: Note;
  draft: ReturnType<typeof useNoteDraft>;
  sourceMode: boolean;
  /** Tighter type for the Graph note panel. */
  compact?: boolean;
}

/** The note's editor (rich or raw markdown), or its loading/error state. */
export function NoteBody({ note, draft, sourceMode, compact }: NoteBodyProps) {
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
        compact={compact}
      />
    </Suspense>
  );
}
