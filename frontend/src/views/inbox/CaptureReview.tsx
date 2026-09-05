import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { TextDiff } from "../../components/TextDiff";
import {
  findDuplicateCaptures,
  mergeCaptureReview,
  type DuplicateEvidence,
} from "../../api/captureReview";
import { getNote } from "../../api/notes";
import { ApiError } from "../../api/client";
import { captureRelPath } from "../../api/captures";
import type { Capture } from "../../data/types";

interface LoadedTarget {
  body: string;
  modified: string;
}

function appendCapture(targetBody: string, proposedBody: string): string {
  return `${targetBody}${targetBody.endsWith("\n") ? "" : "\n\n"}${proposedBody}`;
}

export function CaptureReview({
  capture,
  proposedBody,
  onMerged,
  onSeparate,
}: {
  capture: Capture;
  proposedBody: string;
  onMerged: () => void;
  onSeparate: () => void;
}): ReactNode {
  const [duplicates, setDuplicates] = useState<DuplicateEvidence[]>([]);
  const [body, setBody] = useState("");
  const [target, setTarget] = useState<DuplicateEvidence | null>(null);
  const [loadedTarget, setLoadedTarget] = useState<LoadedTarget | null>(null);
  const [baseModified, setBaseModified] = useState("");
  const [conflictTarget, setConflictTarget] = useState<LoadedTarget | null>(
    null,
  );
  const [loadingTarget, setLoadingTarget] = useState(false);
  const [merging, setMerging] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const duplicateRequest = useRef(0);
  const targetRequest = useRef(0);
  const targetAbort = useRef<AbortController | null>(null);
  const mergeAbort = useRef<AbortController | null>(null);
  const path = captureRelPath(capture);
  const busy = loadingTarget || merging || reloading;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      targetAbort.current?.abort();
      mergeAbort.current?.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const requestId = ++duplicateRequest.current;
    setDuplicates([]);
    setTarget(null);
    setLoadedTarget(null);
    setBody("");
    setBaseModified("");
    setConflictTarget(null);
    setError(null);
    void findDuplicateCaptures(path, controller.signal)
      .then((items) => {
        if (
          !controller.signal.aborted &&
          mounted.current &&
          requestId === duplicateRequest.current
        ) {
          setDuplicates(items);
        }
      })
      .catch((err: unknown) => {
        if (
          !controller.signal.aborted &&
          mounted.current &&
          requestId === duplicateRequest.current
        ) {
          setDuplicates([]);
          setError(
            err instanceof Error
              ? err.message
              : "Could not load duplicate suggestions",
          );
        }
      });
    return () => controller.abort();
  }, [path, proposedBody]);

  const loadTarget = async (
    candidate: DuplicateEvidence,
    mode: "choose" | "reload",
  ) => {
    if (busy || (mode === "reload" && !target)) return;
    const requestId = ++targetRequest.current;
    targetAbort.current?.abort();
    const controller = new AbortController();
    targetAbort.current = controller;
    setError(null);
    if (mode === "choose") setLoadingTarget(true);
    else setReloading(true);
    try {
      const note = await getNote(candidate.note_id, controller.signal);
      if (
        controller.signal.aborted ||
        !mounted.current ||
        requestId !== targetRequest.current
      )
        return;
      const current = {
        body: note.body,
        modified: note.content_version ?? note.modified,
      };
      if (mode === "choose") {
        setTarget(candidate);
        setLoadedTarget(current);
        setBaseModified(current.modified);
        setBody(appendCapture(current.body, proposedBody));
        setConflictTarget(null);
      } else {
        // Loading a newer target is comparison only. The user explicitly
        // decides whether to rebase or keep their full edited merge.
        setConflictTarget(current);
      }
    } catch (err) {
      if (
        !controller.signal.aborted &&
        mounted.current &&
        requestId === targetRequest.current
      ) {
        setError(
          err instanceof Error ? err.message : "Could not load target note",
        );
      }
    } finally {
      if (mounted.current && requestId === targetRequest.current) {
        setLoadingTarget(false);
        setReloading(false);
      }
    }
  };

  const choose = (candidate: DuplicateEvidence) => {
    void loadTarget(candidate, "choose");
  };

  const reloadTarget = () => {
    if (target) void loadTarget(target, "reload");
  };

  const keepEditedMerge = () => {
    if (!conflictTarget) return;
    setBaseModified(conflictTarget.modified);
    setLoadedTarget(conflictTarget);
    setConflictTarget(null);
    setError(null);
  };

  const rebaseAppend = () => {
    if (!conflictTarget || !loadedTarget) return;
    const appended = body.startsWith(loadedTarget.body)
      ? body.slice(loadedTarget.body.length)
      : `\n\n${proposedBody}`;
    setBody(`${conflictTarget.body}${appended}`);
    setBaseModified(conflictTarget.modified);
    setLoadedTarget(conflictTarget);
    setConflictTarget(null);
    setError(null);
  };

  const merge = async () => {
    if (!target || busy || conflictTarget) return;
    const controller = new AbortController();
    mergeAbort.current = controller;
    setMerging(true);
    setError(null);
    try {
      await mergeCaptureReview(
        {
          capture_path: path,
          target_note_id: target.note_id,
          body,
          base_modified: baseModified,
        },
        controller.signal,
      );
      if (!controller.signal.aborted && mounted.current) onMerged();
    } catch (err) {
      if (controller.signal.aborted || !mounted.current) return;
      setError(
        err instanceof ApiError && err.status === 409
          ? "This note changed. Your editable merge was kept; reload the target to compare it before retrying."
          : err instanceof Error
            ? err.message
            : "Merge failed",
      );
    } finally {
      if (mounted.current && mergeAbort.current === controller)
        setMerging(false);
    }
  };

  return (
    <section className="capture-review" aria-label="Duplicate review">
      <h3>Review before filing</h3>
      <TextDiff before={capture.body} after={proposedBody} />
      {duplicates.length > 0 && (
        <>
          <h4>Possible duplicates</h4>
          {duplicates.map((candidate) => (
            <div key={candidate.note_id} className="capture-duplicate">
              <button
                type="button"
                disabled={busy}
                onClick={() => choose(candidate)}
              >
                {loadingTarget
                  ? "Loading target…"
                  : `Append to ${candidate.title}`}
              </button>
              <span>{candidate.rationale}</span>
            </div>
          ))}
        </>
      )}
      {target && (
        <>
          <label>
            Editable merged note
            <textarea
              aria-label="Merged note body"
              value={body}
              disabled={busy}
              onChange={(event) => setBody(event.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={busy || !!conflictTarget}
            onClick={() => void merge()}
          >
            {merging ? "Merging…" : `Merge into ${target.title}`}
          </button>
          {error && !conflictTarget && (
            <button type="button" disabled={busy} onClick={reloadTarget}>
              Reload target for comparison
            </button>
          )}
        </>
      )}
      {conflictTarget && (
        <section aria-label="Target conflict comparison">
          <h4>Latest target and your edited merge</h4>
          <TextDiff before={conflictTarget.body} after={body} />
          <p>
            Your merge remains unchanged until you choose one of these actions.
          </p>
          <button type="button" disabled={busy} onClick={rebaseAppend}>
            Rebase appended text onto latest target
          </button>
          <button type="button" disabled={busy} onClick={keepEditedMerge}>
            Keep edited merge
          </button>
        </section>
      )}
      <button type="button" disabled={busy} onClick={onSeparate}>
        Create separately
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
