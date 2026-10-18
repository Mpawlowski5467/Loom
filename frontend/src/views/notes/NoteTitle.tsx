import { useState, type KeyboardEvent } from "react";
import type { Note } from "@/data/types";
import { cn } from "@/lib/utils";

interface NoteTitleProps {
  note: Note;
  /** Save a new title against the version the edit started from. */
  onRename: (title: string, base: string) => Promise<boolean>;
}

/** The note title, renamed in place (Enter saves, Esc cancels). */
export function NoteTitle({ note, onRename }: NoteTitleProps) {
  const [editing, setEditing] = useState<{
    draft: string;
    base: string;
  } | null>(null);

  const commit = async () => {
    if (!editing) return;
    if (await onRename(editing.draft, editing.base)) setEditing(null);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditing(null);
    }
  };
  const titleClass =
    "w-full text-[34px] leading-tight font-semibold tracking-tight text-foreground";

  if (editing)
    return (
      <input
        aria-label="Note title"
        autoFocus
        value={editing.draft}
        onChange={(e) => setEditing({ ...editing, draft: e.target.value })}
        onBlur={() => void commit()}
        onKeyDown={onKeyDown}
        className={cn(
          titleClass,
          "rounded-md bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      />
    );
  return (
    <h1 className={titleClass}>
      <button
        type="button"
        title="Rename"
        onClick={() =>
          setEditing({
            draft: note.title,
            base: note.contentVersion ?? note.modified,
          })
        }
        className="w-full rounded-md text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {note.title}
      </button>
    </h1>
  );
}
