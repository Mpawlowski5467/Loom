import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import type { DuplicateEvidence } from "@/api/captureReview";
import { TextDiff } from "@/components/TextDiff";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Capture } from "@/data/types";
import { useCaptureMerge } from "./useCaptureMerge";

/**
 * Close matches for a capture and the explicit, version-checked merge into
 * one of them. Reports what it found so the pre-check can mention it.
 */
export function CaptureReview({
  capture,
  proposedBody,
  onMerged,
  onSeparate,
  onDuplicates,
}: {
  capture: Capture;
  proposedBody: string;
  onMerged: () => void;
  onSeparate: () => void;
  onDuplicates?: (found: DuplicateEvidence[]) => void;
}): ReactNode {
  const {
    duplicates,
    body,
    setBody,
    target,
    conflictTarget,
    loadingTarget,
    merging,
    busy,
    error,
    choose,
    reloadTarget,
    keepEditedMerge,
    rebaseAppend,
    merge,
  } = useCaptureMerge(capture, proposedBody, onMerged, onDuplicates);
  if (duplicates.length === 0 && !target && !error) return null;
  return (
    <section aria-label="Duplicate review" className="flex flex-col gap-3">
      {duplicates.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md border border-warning-border bg-warning p-3 text-sm text-warning-foreground">
          <h4 className="flex items-center gap-1.5 font-medium">
            <TriangleAlert aria-hidden="true" className="size-4" />
            Close match
          </h4>
          {duplicates.map((candidate) => (
            <div
              key={candidate.note_id}
              className="flex flex-wrap items-center gap-2"
            >
              <span className="min-w-0 flex-1">
                Looks like <strong>{candidate.title}</strong>
                {candidate.rationale ? ` — ${candidate.rationale}` : ""}
              </span>
              <Button
                size="xs"
                variant="outline"
                disabled={busy}
                onClick={() => choose(candidate)}
              >
                {loadingTarget
                  ? "Loading target…"
                  : `Append to ${candidate.title}`}
              </Button>
            </div>
          ))}
          {!target && (
            <Button
              size="xs"
              variant="ghost"
              className="self-start"
              disabled={busy}
              onClick={onSeparate}
            >
              Create separately
            </Button>
          )}
        </div>
      )}
      {target && (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`merge-${capture.id}`}>Editable merged note</Label>
          <Textarea
            id={`merge-${capture.id}`}
            aria-label="Merged note body"
            value={body}
            disabled={busy}
            onChange={(event) => setBody(event.target.value)}
            className="min-h-48 font-mono text-xs"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy || !!conflictTarget}
              onClick={() => void merge()}
            >
              {merging ? "Merging…" : `Merge into ${target.title}`}
            </Button>
            {error && !conflictTarget && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={reloadTarget}
              >
                Reload target for comparison
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={onSeparate}
            >
              Create separately
            </Button>
          </div>
        </div>
      )}
      {conflictTarget && (
        <section
          aria-label="Target conflict comparison"
          className="flex flex-col gap-2 rounded-md border border-border p-3"
        >
          <h4 className="text-sm font-medium">
            Latest target and your edited merge
          </h4>
          <TextDiff before={conflictTarget.body} after={body} />
          <p className="text-xs text-muted-foreground">
            Your merge remains unchanged until you choose one of these actions.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={rebaseAppend}
            >
              Rebase appended text onto latest target
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={keepEditedMerge}
            >
              Keep edited merge
            </Button>
          </div>
        </section>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger-foreground">
          {error}
        </p>
      )}
    </section>
  );
}
