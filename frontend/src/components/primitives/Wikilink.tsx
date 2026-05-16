import type { ReactNode } from "react";
import { useApp } from "../../context/app-ctx";

interface Props {
  target: string;
  label?: string;
  block?: boolean;
}

export function Wikilink({ target, label, block }: Props): ReactNode {
  const { resolveWikilink, openNote, noteById } = useApp();
  const id = resolveWikilink(target);
  const note = id ? noteById(id) : undefined;
  const text = label ?? target;
  const unresolved = !id;

  return (
    <button
      className={`wikilink ${block ? "backlink" : ""}`}
      onClick={() => {
        if (id) openNote(id);
      }}
      disabled={unresolved}
      title={note ? `${note.type} · ${note.folder}` : `unresolved: ${target}`}
      aria-label={`Open note ${text}`}
      style={unresolved ? { opacity: 0.5 } : undefined}
    >
      {text}
    </button>
  );
}
