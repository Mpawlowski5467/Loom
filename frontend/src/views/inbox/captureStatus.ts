import type { CaptureJob } from "@/api/captures";
import type { Capture } from "@/data/types";

export type RowStatus =
  | "proposal"
  | "new"
  | "queued"
  | "processing"
  | "retrying"
  | "review"
  | "failed"
  | "cancelled"
  | "filed";

/** One status per capture: the durable job state wins over the capture's. */
export function rowStatus(
  c: Capture,
  job: CaptureJob | undefined,
  proposalReady: boolean,
): RowStatus {
  if (c.status === "done" || job?.status === "completed") return "filed";
  switch (job?.status) {
    case "queued":
      return "queued";
    case "running":
      return "processing";
    case "retrying":
      return "retrying";
    case "needs_review":
      return "review";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
  }
  if (c.status === "processing") return "processing";
  if (c.status === "needs_review" || c.reviewRequired) return "review";
  if (c.status === "failed") return "failed";
  return proposalReady || c.suggestion ? "proposal" : "new";
}

export const STATUS_LABEL: Record<RowStatus, string> = {
  proposal: "Proposal ready",
  new: "New",
  queued: "Queued",
  processing: "Processing",
  retrying: "Retrying",
  review: "Needs review",
  failed: "Failed",
  cancelled: "Cancelled",
  filed: "Filed",
};

export const STATUS_CLASS: Record<RowStatus, string> = {
  proposal: "border-brand/40 text-brand",
  new: "border-border text-muted-foreground",
  queued: "border-border text-secondary-foreground",
  processing: "border-brand/40 text-brand",
  retrying: "border-warning-border text-warning-foreground",
  review: "border-warning-border bg-warning text-warning-foreground",
  failed: "border-danger-foreground/40 text-danger-foreground",
  cancelled: "border-border text-muted-foreground",
  filed: "border-ok/40 text-ok-foreground",
};
