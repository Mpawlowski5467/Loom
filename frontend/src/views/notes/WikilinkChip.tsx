import { useApp } from "@/context/app-ctx";
import { wikilinkCandidates } from "@/data/wikilinks";
import { cn } from "@/lib/utils";

interface WikilinkChipProps {
  /** Link target as written: "note", "folder/note", "note#Heading". */
  target: string;
  alias?: string;
  className?: string;
}

/**
 * A `[[wikilink]]` rendered as a chip outside the editor (banners,
 * suggestions). Resolved links open the note; unresolved ones are dashed.
 */
export function WikilinkChip({ target, alias, className }: WikilinkChipProps) {
  const { resolveWikilink, openNote, notes } = useApp();
  const [path, heading = ""] = target.split("#", 2) as [string, string?];
  const id = resolveWikilink(path);
  const ambiguous = !id && wikilinkCandidates(notes, path).length > 1;
  const label = alias ?? target;
  const base =
    "inline rounded-sm px-1.5 py-px align-baseline font-medium leading-snug [box-decoration-break:clone]";
  if (!id)
    return (
      <span
        title={
          ambiguous
            ? "More than one note matches this link"
            : "No note with this name yet"
        }
        className={cn(
          base,
          "border border-dashed border-chip-foreground/50 text-chip-foreground",
          className,
        )}
      >
        {label}
      </span>
    );
  return (
    <button
      type="button"
      onClick={() => openNote(id, heading)}
      className={cn(
        base,
        "bg-chip text-chip-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className,
      )}
    >
      {label}
    </button>
  );
}
