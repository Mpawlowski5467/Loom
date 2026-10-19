import { useEffect, useState } from "react";
import { getRelatedNotes, type RelatedResult } from "@/api/related";
import { Skeleton } from "@/components/ui/skeleton";
import { useApp } from "@/context/app-ctx";
import { isSuperseded } from "@/data/supersession";
import type { Note } from "@/data/types";
import { cn } from "@/lib/utils";

const SOURCE_NOTE: Record<RelatedResult["source"], string | null> = {
  related: null,
  search: "Ranked by hybrid search on the title.",
  local: "Offline: ranked by shared links and tags.",
};

/** Hybrid-search matches for the note, with relative score bars. */
export function RelatedList({ note }: { note: Note }) {
  const { notes, noteById, openNote } = useApp();
  const [result, setResult] = useState<{
    id: string;
    value: RelatedResult;
  } | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    getRelatedNotes(note, notes, ctrl.signal).then(
      (value) => setResult({ id: note.id, value }),
      () => undefined,
    );
    return () => ctrl.abort();
    // Re-rank when the note changes, not on every unrelated vault update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id, note.modified]);

  const current = result?.id === note.id ? result.value : null;
  return (
    <section aria-labelledby="rail-related">
      <h2
        id="rail-related"
        className="mb-2 text-xs font-medium text-muted-foreground"
      >
        Related
      </h2>
      {!current ? (
        <div className="flex flex-col gap-2" aria-label="Loading related notes">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-6" />
          ))}
        </div>
      ) : current.items.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing related yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {current.items.map((item) => {
            const superseded = (() => {
              const n = noteById(item.noteId);
              return !!n && isSuperseded(n);
            })();
            return (
              <li key={item.noteId}>
                <button
                  type="button"
                  onClick={() => openNote(item.noteId)}
                  className="group flex w-full flex-col gap-1 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <span
                    className={cn(
                      "truncate text-sm text-secondary-foreground",
                      superseded && "text-muted-foreground line-through",
                    )}
                  >
                    {item.title}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                      <span
                        className={cn(
                          "block h-full rounded-full",
                          superseded ? "bg-border-strong" : "bg-brand",
                        )}
                        style={{ width: `${Math.round(item.score * 100)}%` }}
                      />
                    </span>
                    <span className="w-8 text-right font-mono text-[10px] text-muted-foreground tabular-nums">
                      {item.score.toFixed(2)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {current && SOURCE_NOTE[current.source] && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {SOURCE_NOTE[current.source]}
        </p>
      )}
    </section>
  );
}
