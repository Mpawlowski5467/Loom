import { useState, type ReactNode } from "react";
import { useApp } from "../../context/app-ctx";
import { wikilinkCandidates, linkTarget } from "../../data/wikilinks";

interface Props {
  target: string;
  label?: string;
  block?: boolean;
  onOpen?: (target: string) => void;
}

export function Wikilink({ target, label, block, onOpen }: Props): ReactNode {
  const {
    resolveWikilink,
    openNote,
    noteById,
    setNewNoteOpen,
    setNewNoteTitle,
    notes,
  } = useApp();
  const id = resolveWikilink(target);
  const note = id ? noteById(id) : undefined;
  const text = label ?? target;
  const [choosing, setChoosing] = useState(false);
  const candidates = !id ? wikilinkCandidates(notes ?? [], target) : [];
  const heading = target.split("|", 1)[0]!.split("#").slice(1).join("#");

  if (candidates.length > 1)
    return (
      <span className="wikilink-choice">
        <button
          className="wikilink"
          aria-expanded={choosing}
          title="Several notes match this link"
          onClick={() => setChoosing(!choosing)}
        >
          {text} ▾
        </button>
        {choosing && (
          <span role="group" aria-label={`Choose note for ${text}`}>
            {candidates.map((candidate) => (
              <button
                key={candidate.id}
                className="wikilink"
                onClick={() => {
                  openNote(candidate.id, heading);
                  setChoosing(false);
                }}
              >
                {candidate.folder}/{candidate.filename ?? candidate.title}
              </button>
            ))}
          </span>
        )}
      </span>
    );

  if (!id) {
    // Unresolved link — offer to create the missing note instead of dead-ending.
    return (
      <button
        className={`wikilink wikilink-new ${block ? "backlink" : ""}`}
        onClick={() => {
          setNewNoteTitle(
            target.split("|", 1)[0]!.split("#", 1)[0]!.trim() ||
              linkTarget(target),
          );
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
        if (heading) openNote(id, heading);
        else openNote(id);
      }}
      title={note ? `${note.type} · ${note.folder}` : target}
      aria-label={`Open note ${text}`}
    >
      {text}
    </button>
  );
}
