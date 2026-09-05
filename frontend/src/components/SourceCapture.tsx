import { useState } from "react";
import { apiClient } from "../api/client";
import type { NoteRecord } from "../api/notes";
import { renderMarkdown } from "../editor/renderMarkdown";

export function SourceCapture({ noteId }: { noteId: string }) {
  const [source, setSource] = useState<NoteRecord | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <details
      className="revision-panel"
      onToggle={(event) => {
        if (!event.currentTarget.open || source || busy) return;
        setBusy(true);
        setError("");
        void apiClient
          .get<NoteRecord>(`/api/sources/${encodeURIComponent(noteId)}`)
          .then(setSource)
          .catch((err: unknown) =>
            setError(
              err instanceof Error ? err.message : "Could not load original",
            ),
          )
          .finally(() => setBusy(false));
      }}
    >
      <summary>Original capture</summary>
      {busy && <p role="status">Loading original…</p>}
      {error && <p role="alert">{error}</p>}
      {source && (
        <section>
          <h3>{source.title}</h3>
          {renderMarkdown(source.body, { headingIdPrefix: "source-" })}
        </section>
      )}
    </details>
  );
}
