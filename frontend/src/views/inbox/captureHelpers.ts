import type {
  CaptureJob,
  CaptureProcessingPolicy,
  CommitResult,
  ProcessResult,
} from "@/api/captures";
import type { Capture, CaptureOutcome } from "@/data/types";

export const DEFAULT_PROCESSING_POLICY: CaptureProcessingPolicy = {
  mode: "manual",
  trusted_sources: [],
  concurrency: 1,
  max_retries: 2,
  base_backoff_seconds: 5,
  stale_running_seconds: 1800,
};

export function isDemoCapture(capture: Capture): boolean {
  return !capture.filePath && Boolean(capture.suggestion);
}

export function outcomeOf(
  result: ProcessResult | CommitResult,
): CaptureOutcome {
  if (result.outcome) return result.outcome;
  if (result.review_required) return "needs_review";
  if (result.capture_archived) return "filed";
  if ("processed" in result) {
    // Compatibility with older backends, which only returned ``processed``.
    return result.processed ? "filed" : "failed";
  }
  // A committed note whose source capture was not archived is intentionally
  // still actionable in the Inbox; fail closed to review instead of hiding it.
  return "needs_review";
}

export function retryableStatus(
  capture: Capture,
): "pending" | "needs_review" | "failed" {
  if (capture.status === "needs_review" || capture.reviewRequired)
    return "needs_review";
  return capture.status === "failed" ? "failed" : "pending";
}

/** Job states during which a capture can't be selected or acted on. */
export function jobBusy(job: CaptureJob | undefined): boolean {
  const s = job?.status;
  return (
    s === "queued" || s === "running" || s === "retrying" || s === "completed"
  );
}

export type InboxFilter = "all" | "review" | "filed";

/** Which list tab a capture belongs to (besides All). */
export function captureMatchesFilter(
  capture: Capture,
  job: CaptureJob | undefined,
  filter: InboxFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "filed") return capture.status === "done";
  const s = job?.status;
  return (
    capture.status === "needs_review" ||
    capture.status === "failed" ||
    capture.reviewRequired === true ||
    s === "needs_review" ||
    s === "failed"
  );
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
