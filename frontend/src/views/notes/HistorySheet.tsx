import { ConnectionEvidence } from "@/components/ConnectionEvidence";
import { NoteHistory } from "@/components/NoteHistory";
import { RevisionHistory } from "@/components/RevisionHistory";
import { SourceCapture } from "@/components/SourceCapture";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { Note } from "@/data/types";

interface HistorySheetProps {
  note: Note;
  vaultId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Undo/restore wait for a clean draft. */
  disabled: boolean;
}

/** Change history (git, with undo), versions, source capture, link evidence. */
export function HistorySheet({
  note,
  vaultId,
  open,
  onOpenChange,
  disabled,
}: HistorySheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto sm:max-w-xl"
      >
        <SheetHeader className="border-b border-border">
          <SheetTitle>History</SheetTitle>
          <SheetDescription>
            {disabled
              ? "Save or discard your edits to undo or restore a change."
              : `Changes to ${note.title}, newest first.`}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-6 p-4">
          <NoteHistory
            key={`git:${vaultId}:${note.id}`}
            noteId={note.id}
            folder={note.folder}
            filename={note.filename}
            disabled={disabled}
            alwaysOpen
          />
          <Separator />
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Version history</h3>
            <RevisionHistory
              key={`rev:${vaultId}:${note.id}`}
              noteId={note.id}
              disabled={disabled}
            />
          </section>
          {note.source?.startsWith("capture:") && (
            <>
              <Separator />
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">Original capture</h3>
                <SourceCapture
                  key={`src:${vaultId}:${note.id}`}
                  noteId={note.id}
                />
              </section>
            </>
          )}
          <Separator />
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Link evidence</h3>
            <ConnectionEvidence
              key={`ev:${vaultId}:${note.id}`}
              noteId={note.id}
            />
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
