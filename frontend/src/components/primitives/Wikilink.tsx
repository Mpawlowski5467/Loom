import type { ReactNode } from "react";
import { useApp } from "../../context/app-ctx";

interface Props {
  target: string;
  label?: string;
  block?: boolean;
  onOpen?: (target: string) => void;
}

export function Wikilink({ target, label, block, onOpen }: Props): ReactNode {
  const { resolveWikilink, openNote, noteById, setNewNoteOpen, setNewNoteTitle } =
    useApp();
  const id = resolveWikilink(target);
  const note = id ? noteById(id) : undefined;
  const text = label ?? target;

  if (!id) {
    // Unresolved link — offer to create the missing note instead of dead-ending.
    return (
      <button
        className={`wikilink wikilink-new ${block ? "backlink" : ""}`}
        onClick={() => {
          setNewNoteTitle(target);
          setNewNoteOpen(true);
        }}
        title={`Create note "${target}"`}
        aria-label={`Create note ${text}`}
      >
        {text}
      </button>
    );
  }

  return (
    <button
      className={`wikilink ${block ? "backlink" : ""}`}
      onClick={() => {
        onOpen?.(target);
        openNote(id);
      }}
      title={note ? `${note.type} · ${note.folder}` : target}
      aria-label={`Open note ${text}`}
    >
      {text}
    </button>
  );
}
