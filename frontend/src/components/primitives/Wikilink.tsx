import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useApp } from "../../context/app-ctx";
import { wikilinkCandidates, linkTarget } from "../../data/wikilinks";

/** Same chip as the editor's wikilink element (editor/plate/wikilink.tsx). */
const CHIP =
  "mx-px inline-flex items-center gap-0.5 rounded-sm px-1.5 py-px align-baseline font-sans text-[0.9em] leading-snug font-medium focus-visible:outline-2 focus-visible:outline-ring";
const RESOLVED = "bg-chip text-chip-foreground hover:underline";
const MISSING =
  "border border-dashed border-chip-foreground/50 text-chip-foreground hover:bg-chip";

interface Props {
  target: string;
  label?: string;
  block?: boolean;
  onOpen?: (target: string) => void;
}

/** A `[[wikilink]]` in a markdown preview: open it, pick a match, or create it. */
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
      <span className="inline-flex flex-wrap items-baseline gap-1">
        <button
          className={cn(CHIP, MISSING)}
          aria-expanded={choosing}
          title="Several notes match this link"
          onClick={() => setChoosing(!choosing)}
        >
          {text}
          <ChevronDown aria-hidden="true" className="size-3" />
        </button>
        {choosing && (
          <span
            role="group"
            aria-label={`Choose note for ${text}`}
            className="inline-flex flex-wrap gap-1"
          >
            {candidates.map((candidate) => (
              <button
                key={candidate.id}
                className={cn(CHIP, RESOLVED, "font-mono text-[0.8em]")}
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
        className={cn(CHIP, MISSING, block && "flex w-fit")}
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
      className={cn(CHIP, RESOLVED, block && "flex w-fit")}
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
