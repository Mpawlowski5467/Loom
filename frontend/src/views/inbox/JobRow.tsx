import type { CaptureJob } from "@/api/captures";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/data/formatDate";
import type { Capture } from "@/data/types";
import { cn } from "@/lib/utils";
import {
  badgeState,
  captureName,
  displayPath,
  failureLabel,
  statusLabel,
} from "./jobLabels";

const TONE: Record<ReturnType<typeof badgeState>, string> = {
  queued: "border-border text-secondary-foreground",
  running: "border-brand/40 text-brand",
  retrying: "border-warning-border text-warning-foreground",
  review: "border-warning-border bg-warning text-warning-foreground",
  success: "border-ok/40 text-ok-foreground",
  idle: "border-border text-muted-foreground",
};

interface JobRowProps {
  job: CaptureJob;
  capture: Capture | undefined;
  busy: boolean;
  actionError: string | undefined;
  onOpenNote: (noteId: string) => void;
  onCancel: () => void;
  onRetry: () => void;
}

/** One processing job: what it's for, where it is, and what to do next. */
export function JobRow({
  job,
  capture,
  busy,
  actionError,
  onOpenNote,
  onCancel,
  onRetry,
}: JobRowProps) {
  const retryable =
    job.status === "failed" ||
    job.status === "needs_review" ||
    job.status === "cancelled";
  const cancellable = job.status === "queued" || job.status === "retrying";
  const fact = "flex flex-col gap-0.5";
  return (
    <li>
      <article className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <header className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-medium text-foreground">
              {capture?.title ?? captureName(job)}
            </h3>
            <p
              className="truncate font-mono text-xs text-muted-foreground"
              title={job.capture_path}
            >
              {displayPath(job.capture_path)}
            </p>
          </div>
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[11px] font-medium",
              TONE[badgeState(job.status)],
            )}
          >
            {statusLabel(job.status)}
          </span>
        </header>
        <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <div className={fact}>
            <dt className="text-muted-foreground">Source</dt>
            <dd className="font-mono">{job.source || "unknown"}</dd>
          </div>
          <div className={fact}>
            <dt className="text-muted-foreground">Attempts</dt>
            <dd>
              {job.attempts} of {job.max_attempts}
            </dd>
          </div>
          <div className={fact}>
            <dt className="text-muted-foreground">Updated</dt>
            <dd title={job.updated_at}>{formatDateTime(job.updated_at)} UTC</dd>
          </div>
          <div className={fact}>
            <dt className="text-muted-foreground">Outcome</dt>
            <dd>{job.outcome ? statusLabel(job.outcome) : "—"}</dd>
          </div>
        </dl>
        {job.note_title && (
          <p className="text-sm text-secondary-foreground">
            Filed as{" "}
            <strong className="text-foreground">{job.note_title}</strong>
            {job.target_path && (
              <span
                className="ml-2 font-mono text-xs text-muted-foreground"
                title={job.target_path}
              >
                {displayPath(job.target_path)}
              </span>
            )}
          </p>
        )}
        {job.error && (
          <p className="font-mono text-xs text-danger-foreground">
            {job.error}
          </p>
        )}
        {job.recommended_action && job.failure_kind !== "none" && (
          <p className="text-sm">
            <strong className="text-foreground">
              {failureLabel(job.failure_kind)}
            </strong>{" "}
            <span className="text-secondary-foreground">
              {job.recommended_action}
            </span>
          </p>
        )}
        {actionError && (
          <p role="alert" className="text-sm text-danger-foreground">
            {actionError}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {job.note_id && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onOpenNote(job.note_id!)}
            >
              Open note
            </Button>
          )}
          {cancellable && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={onCancel}
            >
              {busy ? "Cancelling…" : "Cancel"}
            </Button>
          )}
          {retryable && capture && (
            <Button size="sm" disabled={busy} onClick={onRetry}>
              {busy ? "Queueing…" : "Retry"}
            </Button>
          )}
          {retryable && !capture && (
            <span className="text-xs text-muted-foreground">
              Source capture archived
            </span>
          )}
        </div>
      </article>
    </li>
  );
}
