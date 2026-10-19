import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  acceptConnection,
  getConnections,
  type ConnectionEvidence as Evidence,
} from "../api/connections";
import { describeApiError } from "../api/client";

const QUOTE =
  "border-l-2 border-border-strong pl-3 text-xs text-secondary-foreground";

/** Spider's recorded evidence for a note's links, with Accept for suggestions. */
export function ConnectionEvidence({
  noteId,
  pair,
  emptyMessage,
}: {
  noteId: string;
  pair?: { sourceId: string; targetId: string };
  emptyMessage?: string;
}): ReactNode {
  const [result, setResult] = useState<{
    noteId: string;
    items: Evidence[];
    error?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void getConnections(noteId)
      .then((response) => {
        if (!cancelled) {
          setResult({ noteId, items: response.connections });
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setResult({
            noteId,
            items: [],
            error: describeApiError(err, "Could not load connection evidence"),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [noteId]);
  const loaded = result?.noteId === noteId;
  const items = loaded ? result.items : [];
  if (loaded && result.error)
    return (
      <p role="alert" className="text-sm text-danger-foreground">
        {result.error}
      </p>
    );
  const visibleItems = pair
    ? items.filter(
        (item) =>
          (item.source_id === pair.sourceId &&
            item.target_id === pair.targetId) ||
          (item.source_id === pair.targetId &&
            item.target_id === pair.sourceId),
      )
    : items;
  if (!visibleItems.length) {
    return emptyMessage && loaded ? (
      <p className="text-sm text-muted-foreground">{emptyMessage}</p>
    ) : null;
  }
  return (
    <section
      className="flex flex-col gap-2 text-sm"
      aria-label="Connection evidence"
    >
      <h3 className="sr-only">Connection evidence</h3>
      {visibleItems.map((item, index) => (
        <details
          key={`${item.source_id}-${item.target_id}-${index}`}
          className="group rounded-lg border border-border bg-card"
        >
          <summary className="flex cursor-pointer list-none items-start gap-1.5 rounded-lg px-3 py-2 hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
            <ChevronRight
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
            />
            <span className="min-w-0">
              {item.source_title ?? item.source_id} →{" "}
              {item.target_title ?? item.target_id}
              <span className="text-muted-foreground">
                {" "}
                · {item.direction} · {item.state}
              </span>
            </span>
          </summary>
          <div className="flex flex-col gap-2 px-3 pb-3 pl-9">
            <p className="text-secondary-foreground">{item.rationale}</p>
            <p className="font-mono text-xs text-muted-foreground">
              {item.method}
              {item.agent ? ` · ${item.agent}` : ""}
              {item.created
                ? ` · ${new Date(item.created).toLocaleString()}`
                : ""}
              {item.run_id ? ` · run ${item.run_id}` : ""}
            </p>
            {item.source_excerpt && (
              <blockquote className={QUOTE}>
                Source: {item.source_excerpt}
              </blockquote>
            )}
            {item.target_excerpt && (
              <blockquote className={QUOTE}>
                Target: {item.target_excerpt}
              </blockquote>
            )}
            {item.state === "suggested" && (
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                disabled={accepting}
                onClick={() => {
                  setAccepting(true);
                  setError(null);
                  void acceptConnection(item)
                    .then(() => getConnections(noteId))
                    .then((response) =>
                      setResult({ noteId, items: response.connections }),
                    )
                    .catch((err) =>
                      setError(
                        err instanceof Error
                          ? err.message
                          : "Could not accept connection",
                      ),
                    )
                    .finally(() => setAccepting(false));
                }}
              >
                Accept relation
              </Button>
            )}
          </div>
        </details>
      ))}
      {error && (
        <p role="alert" className="text-danger-foreground">
          {error}
        </p>
      )}
    </section>
  );
}
