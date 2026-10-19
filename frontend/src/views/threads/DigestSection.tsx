import { useState } from "react";
import { Link } from "react-router";
import { noteHref, noteIdHref } from "@/app/routes";
import { CommunityDot } from "@/components/CommunityDot";
import { Button } from "@/components/ui/button";
import { useApp } from "@/context/app-ctx";
import { cn } from "@/lib/utils";
import type { DigestRow } from "./threadModel";

const INITIAL = 8;
const ROW = "flex items-center gap-3 px-3 py-2 text-sm text-foreground";

interface DigestSectionProps {
  title: string;
  rows: readonly DigestRow[];
  empty: string;
}

/** A bordered list of the day's rows: community dot, text, time or meta. */
export function DigestSection({ title, rows, empty }: DigestSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const headingId = `digest-${title.toLowerCase().replace(/\W+/g, "-")}`;
  const shown = expanded ? rows : rows.slice(0, INITIAL);
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2
        id={headingId}
        className="flex items-baseline gap-2 text-sm font-medium text-foreground"
      >
        {title}
        <span className="font-mono text-xs text-muted-foreground">
          {rows.length}
        </span>
      </h2>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground">
          {empty}
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {shown.map((row) => (
            <li key={row.key}>
              <DigestRowView row={row} />
            </li>
          ))}
        </ul>
      )}
      {rows.length > shown.length && (
        <Button
          variant="ghost"
          size="xs"
          className="self-start text-muted-foreground"
          onClick={() => setExpanded(true)}
        >
          Show {rows.length - shown.length} more
        </Button>
      )}
    </section>
  );
}

function DigestRowView({ row }: { row: DigestRow }) {
  const { noteById } = useApp();
  const body = (
    <>
      <CommunityDot slot={row.slot} />
      <span className="min-w-0 flex-1 truncate">{row.text}</span>
      <span className="shrink-0 font-mono text-xs text-muted-foreground">
        {row.meta}
      </span>
    </>
  );
  if (!row.noteId) return <div className={ROW}>{body}</div>;
  const note = noteById(row.noteId);
  return (
    <Link
      to={note ? noteHref(note) : noteIdHref(row.noteId)}
      className={cn(
        ROW,
        "hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
      )}
    >
      {body}
    </Link>
  );
}
