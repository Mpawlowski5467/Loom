import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/data/formatDate";
import { extraProperties } from "@/data/noteProperties";
import { isSuperseded, validFrom } from "@/data/supersession";
import type { Note } from "@/data/types";
import { TagEditor } from "./TagEditor";

/** Base fields shown before "Show more". */
const COLLAPSED = 3;

function StatusBadge({ note }: { note: Note }) {
  if (isSuperseded(note))
    return (
      <Badge variant="outline" className="text-muted-foreground">
        superseded
      </Badge>
    );
  if (note.status === "archived")
    return (
      <Badge
        variant="outline"
        className="border-warning-border bg-warning text-warning-foreground"
      >
        archived
      </Badge>
    );
  return <Badge className="bg-ok text-ok-foreground">current</Badge>;
}

const isDate = (key: string) => key === "created" || key === "modified";

/** Frontmatter as a definition list: status, valid from, tags, the rest. */
export function NoteProperties({
  note,
  onTagsChange,
}: {
  note: Note;
  onTagsChange: (tags: string[]) => Promise<boolean>;
}) {
  const [expanded, setExpanded] = useState(false);
  const rest = extraProperties(note);
  const shown = expanded ? rest : rest.slice(0, COLLAPSED);
  const from = validFrom(note);
  const row = "grid grid-cols-[7rem_1fr] items-center gap-3 py-1";
  const term = "text-xs text-muted-foreground";

  return (
    <dl className="mb-8 border-y border-border py-2 text-sm">
      <div className={row}>
        <dt className={term}>Status</dt>
        <dd>
          <StatusBadge note={note} />
        </dd>
      </div>
      {from && (
        <div className={row}>
          <dt className={term}>Valid from</dt>
          <dd className="font-mono text-xs text-secondary-foreground">
            {from}
          </dd>
        </div>
      )}
      <div className={row}>
        <dt className={term}>Tags</dt>
        <dd>
          <TagEditor tags={note.tags} onChange={onTagsChange} />
        </dd>
      </div>
      {shown.map((p) => (
        <div key={p.key} className={row}>
          <dt className={term}>{p.label}</dt>
          <dd
            className={
              isDate(p.key)
                ? "font-mono text-xs text-secondary-foreground"
                : "truncate text-secondary-foreground"
            }
          >
            {isDate(p.key) ? formatDate(p.value) : p.value}
          </dd>
        </div>
      ))}
      {rest.length > COLLAPSED && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          className="mt-1 rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {expanded
            ? "Show fewer properties"
            : `Show ${rest.length - COLLAPSED} more`}
        </button>
      )}
    </dl>
  );
}
