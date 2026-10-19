import { useCallback } from "react";
import { ApiError } from "@/api/client";
import {
  captureRelPath,
  commitCapture,
  skipCapture,
  type CaptureJob,
  type CapturePreview,
  type CommitResult,
} from "@/api/captures";
import { backendNoteToFrontend, titleMapFromNotes } from "@/api/notes";
import { useApp } from "@/context/app-ctx";
import type { Capture } from "@/data/types";
import { errorText, outcomeOf, retryableStatus } from "./captureHelpers";

/** Skip (discard), file and commit captures; keeps app state in step. */
export function useCaptureActions(remove: (id: string) => void) {
  const { notes, captures, appendNote, setCaptureStatus, pushToast, openNote } =
    useApp();

  /** Archive one capture; demo captures (not on disk) just leave the list. */
  const skipQuietly = useCallback(
    async (capture: Capture) => {
      if (!capture.filePath && capture.suggestion) return remove(capture.id);
      const result = await skipCapture(
        captureRelPath(capture),
        "Skipped by user from Inbox",
      );
      if (result.outcome !== "skipped" && !result.capture_archived)
        throw new Error(result.error || "Capture was not archived");
      remove(capture.id);
    },
    [remove],
  );

  const skipOne = useCallback(
    async (capture: Capture) => {
      setCaptureStatus(capture.id, "processing");
      try {
        await skipQuietly(capture);
        pushToast({
          icon: "✓",
          agent: "archivist",
          body: `Skipped "${capture.title}"`,
        });
      } catch (err) {
        setCaptureStatus(capture.id, retryableStatus(capture));
        pushToast({
          icon: "⚠",
          agent: "archivist",
          body: `Couldn’t skip "${capture.title}": ${errorText(err)}`,
        });
      }
    },
    [pushToast, setCaptureStatus, skipQuietly],
  );

  const skipMany = async (targets: readonly Capture[]) => {
    if (targets.length === 0) return;
    targets.forEach((c) => setCaptureStatus(c.id, "processing"));
    let skipped = 0;
    let failed = 0;
    for (const capture of targets) {
      try {
        await skipQuietly(capture);
        skipped++;
      } catch (err) {
        setCaptureStatus(capture.id, retryableStatus(capture));
        failed++;
        pushToast({
          icon: "⚠",
          agent: "archivist",
          body: `Couldn’t skip "${capture.title}": ${errorText(err)}`,
        });
      }
    }
    pushToast({
      icon: failed === 0 ? "✓" : "⚠",
      agent: "archivist",
      body:
        failed === 0
          ? `Skipped ${skipped} capture${skipped === 1 ? "" : "s"}`
          : `Skipped ${skipped}; ${failed} failed`,
    });
  };

  /** Apply a committed note to app state and report each agent's part. */
  const onCommitted = useCallback(
    (cap: Capture, result: CommitResult) => {
      const filed = outcomeOf(result) === "filed";
      if (filed) {
        appendNote(
          backendNoteToFrontend(result.note, titleMapFromNotes(notes)),
        );
        remove(cap.id);
        pushToast({
          icon: "✓",
          agent: "weaver",
          body: `Filed "${result.note.title}" → ${result.note.type || "note"}`,
        });
      } else {
        setCaptureStatus(cap.id, "needs_review");
        const why = result.validation_reasons[0];
        pushToast({
          icon: "⚠",
          agent: "sentinel",
          body: `"${result.note.title}" remains in Inbox for review${why ? `: ${why}` : ""}`,
        });
      }
      if (result.linked.length + result.suggested.length > 0)
        pushToast({
          icon: "✓",
          agent: "spider",
          body: `${result.linked.length} linked, ${result.suggested.length} suggested`,
        });
      if (result.validation)
        pushToast({
          icon: result.validation === "passed" ? "✓" : "⚠",
          agent: "sentinel",
          body: `Validation: ${result.validation}`,
        });
      if (filed) openNote(result.note.id);
    },
    [notes, appendNote, remove, setCaptureStatus, pushToast, openNote],
  );

  const commitPreview = useCallback(
    async (cap: Capture, preview: CapturePreview) => {
      setCaptureStatus(cap.id, "processing");
      try {
        const result = await commitCapture({
          capture_path: captureRelPath(cap),
          note_type: preview.note_type,
          folder: preview.folder,
          title: preview.title,
          tags: preview.tags,
          body: preview.body,
        });
        onCommitted(cap, result);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          // Already processed (e.g. by a queued job): treat as filed.
          remove(cap.id);
          pushToast({
            icon: "✓",
            agent: "weaver",
            body: "Capture already processed.",
          });
          return;
        }
        setCaptureStatus(cap.id, "pending");
        pushToast({
          icon: "⚠",
          agent: "weaver",
          body: `Failed to file: ${errorText(err)}`,
        });
      }
    },
    [setCaptureStatus, onCommitted, remove, pushToast],
  );

  /** Demo captures carry a seed suggestion and file locally. */
  const fileDemo = useCallback(
    (capId: string) => {
      const cap = captures.find((c) => c.id === capId);
      if (!cap?.suggestion) return;
      const now = new Date().toISOString();
      const noteId = `demo_filed_${cap.id}`;
      appendNote({
        id: noteId,
        title: cap.suggestion.title,
        type: cap.suggestion.type,
        folder: cap.suggestion.destFolder,
        tags: cap.suggestion.tags,
        body: cap.body,
        links: cap.suggestion.links,
        history: [
          {
            action: "created",
            by: "agent:weaver",
            at: now,
            reason: "Filed from the demo Inbox",
          },
        ],
        created: now,
        modified: now,
        status: "active",
        source: `capture:${cap.id}`,
      });
      remove(capId);
      pushToast({
        icon: "✓",
        agent: "weaver",
        body: `Filed ${cap.suggestion.title} → ${cap.suggestion.destFolder}/`,
      });
      openNote(noteId);
    },
    [appendNote, captures, openNote, pushToast, remove],
  );

  /**
   * Approve and file: retry a capture stuck in review, file a demo seed,
   * or commit the fetched preview.
   */
  const approve = (
    capture: Capture,
    job: CaptureJob | undefined,
    preview: CapturePreview | undefined,
    requeue: (c: Capture, force: boolean) => void,
  ) => {
    const stuck = [job?.status, capture.status].some(
      (s) => s === "needs_review" || s === "failed",
    );
    if (stuck) return requeue(capture, true);
    if (capture.suggestion) return fileDemo(capture.id);
    if (preview) void commitPreview(capture, preview);
  };

  return { skipOne, skipMany, onCommitted, approve };
}
