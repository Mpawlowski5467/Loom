import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface NewNoteTagsProps {
  tags: string[];
  draft: string;
  onDraftChange: (value: string) => void;
  onCommit: () => void;
  onRemove: (tag: string) => void;
  onRemoveLast: () => void;
}

/** Tag chips plus a draft field: Enter or comma adds, Backspace removes. */
export function NewNoteTags({
  tags,
  draft,
  onDraftChange,
  onCommit,
  onRemove,
  onRemoveLast,
}: NewNoteTagsProps) {
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Plain Enter / comma commits a chip; ⌘/Ctrl+Enter bubbles up to submit.
    if ((e.key === "Enter" || e.key === ",") && !(e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onCommit();
    } else if (e.key === "Backspace" && draft === "" && tags.length > 0) {
      e.preventDefault();
      onRemoveLast();
    }
  };

  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input px-2 py-1 shadow-xs focus-within:border-ring focus-within:ring-2 focus-within:ring-ring dark:bg-input/30">
      {tags.map((t) => (
        <Badge
          key={t}
          variant="secondary"
          className="gap-1 pr-1 font-mono text-[11px]"
        >
          #{t}
          <button
            type="button"
            aria-label={`Remove tag ${t}`}
            onClick={() => onRemove(t)}
            className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <X aria-hidden="true" className="size-3" />
          </button>
        </Badge>
      ))}
      <input
        aria-label="Tags"
        value={draft}
        placeholder={tags.length === 0 ? "Type a tag, Enter to add" : ""}
        onChange={(e) => onDraftChange(e.target.value)}
        onKeyDown={onKey}
        className="h-7 min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
