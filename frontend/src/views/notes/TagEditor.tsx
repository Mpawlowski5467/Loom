import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";

interface TagEditorProps {
  tags: string[];
  onChange: (tags: string[]) => Promise<boolean>;
}

/** Tag chips with remove buttons and an inline "add tag" field. */
export function TagEditor({ tags, onChange }: TagEditorProps) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const apply = async (next: string[]) => {
    setBusy(true);
    const ok = await onChange(next);
    setBusy(false);
    return ok;
  };
  const add = async () => {
    const tag = draft.trim().replace(/^#/, "");
    if (tag && !tags.includes(tag) && !(await apply([...tags, tag]))) return;
    setDraft("");
    setAdding(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <Badge
          key={tag}
          variant="secondary"
          className="gap-1 pr-1 font-mono text-[11px]"
        >
          #{tag}
          <button
            type="button"
            aria-label={`Remove tag ${tag}`}
            disabled={busy}
            onClick={() => void apply(tags.filter((t) => t !== tag))}
            className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <X className="size-3" aria-hidden="true" />
          </button>
        </Badge>
      ))}
      {adding ? (
        <input
          aria-label="Add tag"
          autoFocus
          value={draft}
          disabled={busy}
          placeholder="tag"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => (draft.trim() ? void add() : setAdding(false))}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              void add();
            }
            if (e.key === "Escape") {
              setDraft("");
              setAdding(false);
            }
          }}
          className="h-5 w-24 rounded-sm border border-border bg-muted px-1.5 font-mono text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex h-5 items-center gap-0.5 rounded-sm px-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Plus className="size-3" aria-hidden="true" />
          Add tag
        </button>
      )}
    </div>
  );
}
