import type { ReactNode } from "react";
import { Wikilink } from "../../components/primitives/Wikilink";
import type { CaptureJob, CaptureJobStatus } from "../../api/captures";
import type { Capture, Note } from "../../data/types";
import { formatMonthDay, formatTime } from "../../data/formatDate";

interface Props {
  capture: Capture;
  job?: CaptureJob;
  isActive: boolean;
  isChecked: boolean;
  selectionDisabled?: boolean;
  noteById: (id: string) => Note | undefined;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}

/** A single capture row in the triage list. */
export function CaptureCard({
  capture: c,
  job,
  isActive,
  isChecked,
  selectionDisabled = false,
  noteById,
  onSelect,
  onToggle,
}: Props): ReactNode {
  const filed = c.status === "done";
  const state = captureDisplayStatus(c, job);
  const filedNote = filed && c.filedAs ? noteById(c.filedAs) : undefined;
  return (
    <div
      className="inbox-card"
      role="button"
      tabIndex={0}
      aria-current={isActive}
      onClick={() => onSelect(c.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(c.id);
        }
      }}
    >
      <input
        type="checkbox"
        className="inbox-card-check"
        checked={isChecked}
        disabled={selectionDisabled}
        onChange={() => onToggle(c.id)}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Select ${c.title}`}
      />
      <div className="inbox-card-body">
        <div className="inbox-card-h">
          <span className="inbox-card-title">{c.title}</span>
          {!filed && (
            <span className="status-badge" data-state={badgeState(state)}>
              <span className="pulse-dot" />
              {statusLabel(state)}
            </span>
          )}
        </div>
        <div className="inbox-card-meta">
          <span>{c.folder}/</span>
          {c.source && (
            <>
              <span>·</span>
              <span className="inbox-source-badge">{c.source}</span>
            </>
          )}
          <span>·</span>
          <span>
            {formatTime(c.receivedAt)} · {formatMonthDay(c.receivedAt)}
          </span>
          {job && job.attempts > 0 && (
            <span className="inbox-job-attempt">
              · attempt {job.attempts}/{job.max_attempts}
            </span>
          )}
        </div>
        {filedNote && (
          <div className="inbox-card-filed">
            filed as <Wikilink target={filedNote.title} />
          </div>
        )}
      </div>
    </div>
  );
}

type CaptureDisplayStatus = CaptureJobStatus | "pending" | "running" | "done";

/** Prefer the durable job state over the capture's legacy display status. */
function captureDisplayStatus(
  capture: Capture,
  job?: CaptureJob,
): CaptureDisplayStatus {
  if (job) return job.status;
  if (capture.status === "processing") return "running";
  return capture.status;
}

function statusLabel(status: CaptureDisplayStatus): string {
  if (status === "needs_review") return "needs review";
  return status.replaceAll("_", " ");
}

function badgeState(
  status: CaptureDisplayStatus,
): "queued" | "running" | "retrying" | "review" | "success" | "idle" {
  if (status === "queued") return "queued";
  if (status === "running") return "running";
  if (status === "retrying") return "retrying";
  if (status === "failed" || status === "needs_review") return "review";
  if (status === "completed" || status === "done") return "success";
  return "idle";
}
