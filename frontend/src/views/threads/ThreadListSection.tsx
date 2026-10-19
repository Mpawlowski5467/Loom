import type { LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { threadHref } from "@/app/routes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const INITIAL = 10;

export interface ThreadRow {
  id: string;
  label: string;
  meta?: ReactNode;
}

interface ThreadListSectionProps {
  title: string;
  icon: LucideIcon;
  rows: readonly ThreadRow[];
  selectedId: string | null;
  empty: string;
}

/** One group of the Threads list, collapsed to the newest ten. */
export function ThreadListSection({
  title,
  icon: Icon,
  rows,
  selectedId,
  empty,
}: ThreadListSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const selectedAt = rows.findIndex((r) => r.id === selectedId);
  const limit = expanded ? rows.length : Math.max(INITIAL, selectedAt + 1);
  const headingId = `threads-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      <h2
        id={headingId}
        className="flex items-center gap-2 px-2 py-1 text-xs font-medium text-muted-foreground"
      >
        <Icon aria-hidden="true" className="size-3.5" />
        {title}
        <span className="ml-auto font-mono text-[10px]">{rows.length}</span>
      </h2>
      {rows.length === 0 ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col">
          {rows.slice(0, limit).map((row) => {
            const active = row.id === selectedId;
            return (
              <li key={row.id}>
                <Link
                  to={threadHref(row.id)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-secondary-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
                    active && "bg-nav-active text-nav-active-foreground",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{row.label}</span>
                  {row.meta}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {rows.length > limit && (
        <Button
          variant="ghost"
          size="xs"
          className="self-start text-muted-foreground"
          onClick={() => setExpanded(true)}
        >
          Show {rows.length - limit} more
        </Button>
      )}
    </section>
  );
}
