import { BookOpen } from "lucide-react";
import type { ResearcherReference } from "@/api/researcher";
import { useApp } from "@/context/app-ctx";

/** The vault passages an answer used; each opens its note. */
export function SourceCards({ sources }: { sources: ResearcherReference[] }) {
  const { openNote } = useApp();
  if (sources.length === 0)
    return (
      <p className="text-xs text-muted-foreground">
        No vault sources were returned for this answer.
      </p>
    );
  return (
    <section
      aria-label={`${sources.length} vault source${sources.length === 1 ? "" : "s"}`}
      className="flex flex-col gap-2"
    >
      <h4 className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
        Vault sources · {sources.length}
      </h4>
      <div className="grid gap-2 sm:grid-cols-2">
        {sources.map((s) => (
          <button
            key={`${s.note_id}:${s.heading ?? ""}`}
            type="button"
            onClick={() => openNote(s.note_id)}
            aria-label={`Open source ${s.title}`}
            title={s.path || s.title}
            className="flex items-start gap-2 rounded-md border border-border bg-card p-2.5 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <BookOpen
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <strong className="truncate text-sm font-medium text-foreground">
                {s.title}
              </strong>
              <span className="truncate text-xs text-muted-foreground">
                {[s.type, s.heading].filter(Boolean).join(" · ") ||
                  "vault note"}
              </span>
              {s.snippet && (
                <small className="line-clamp-2 text-xs text-secondary-foreground">
                  {s.snippet}
                </small>
              )}
            </span>
            {typeof s.score === "number" && Number.isFinite(s.score) && (
              <span className="font-mono text-[11px] text-muted-foreground">
                {Math.round(Math.min(1, Math.max(0, s.score)) * 100)}%
              </span>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}
