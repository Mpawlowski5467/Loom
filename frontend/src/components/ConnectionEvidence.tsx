import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  acceptConnection,
  getConnections,
  type ConnectionEvidence as Evidence,
} from "../api/connections";

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
            error:
              err instanceof Error
                ? err.message
                : "Could not load connection evidence",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [noteId]);
  const loaded = result?.noteId === noteId;
  const items = loaded ? result.items : [];
  if (loaded && result.error) return <p role="alert">{result.error}</p>;
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
      <p className="connection-evidence-empty">{emptyMessage}</p>
    ) : null;
  }
  return (
    <section className="connection-evidence" aria-label="Connection evidence">
      <h3>Connection evidence</h3>
      {visibleItems.map((item, index) => (
        <details key={`${item.source_id}-${item.target_id}-${index}`}>
          <summary>
            {item.source_title ?? item.source_id} →{" "}
            {item.target_title ?? item.target_id} · {item.direction} ·{" "}
            {item.state}
          </summary>
          <p>{item.rationale}</p>
          <p className="muted">
            {item.method}
            {item.agent ? ` · ${item.agent}` : ""}
            {item.created
              ? ` · ${new Date(item.created).toLocaleString()}`
              : ""}
            {item.run_id ? ` · run ${item.run_id}` : ""}
          </p>
          {item.source_excerpt && (
            <blockquote>Source: {item.source_excerpt}</blockquote>
          )}
          {item.target_excerpt && (
            <blockquote>Target: {item.target_excerpt}</blockquote>
          )}
          {item.state === "suggested" && (
            <button
              type="button"
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
            </button>
          )}
        </details>
      ))}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
