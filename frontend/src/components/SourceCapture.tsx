import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { apiClient } from "../api/client";
import type { NoteRecord } from "../api/notes";
import { MARKDOWN_PROSE } from "../editor/markdownProse";
import { renderMarkdown } from "../editor/renderMarkdown";

/** The capture a note was filed from, loaded when first expanded. */
export function SourceCapture({ noteId }: { noteId: string }) {
  const [source, setSource] = useState<NoteRecord | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <details
      className="group flex flex-col gap-2 text-sm"
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
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="size-4 transition-transform group-open:rotate-90"
        />
        Original capture
      </summary>
      {busy && (
        <p role="status" className="text-muted-foreground">
          Loading original…
        </p>
      )}
      {error && (
        <p role="alert" className="text-danger-foreground">
          {error}
        </p>
      )}
      {source && (
        <section className="mt-2 flex flex-col gap-1 rounded-lg border border-border p-3">
          <h4 className="text-sm font-medium text-foreground">
            {source.title}
          </h4>
          <div className={MARKDOWN_PROSE}>
            {renderMarkdown(source.body, { headingIdPrefix: "source-" })}
          </div>
        </section>
      )}
    </details>
  );
}
