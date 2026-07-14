import type { ReactNode } from "react";
import { Button } from "../../components/primitives/Button";
import { AgentBlob } from "../../components/primitives/AgentBlob";
import { renderMarkdown } from "../../editor/renderMarkdown";
import { SuggestionCard } from "./SuggestionCard";
import { toNodeType, type CardData, type CardLink } from "./types";
import type { CaptureJob, CapturePreview } from "../../api/captures";
import type { Capture, Note } from "../../data/types";
import { formatDateTime } from "../../data/formatDate";

/** Per-capture state of the lazily-fetched Weaver preview. */
export type PreviewState =
  | { status: "ready"; preview: CapturePreview }
  | { status: "error"; message: string };

interface Props {
  capture: Capture;
  job?: CaptureJob;
  jobBusy?: boolean;
  canQueue?: boolean;
  preview: PreviewState | undefined;
  noteById: (id: string) => Note | undefined;
  onAccept: () => void;
  onEdit: () => void;
  onSkip: () => void;
  onRetry: (id: string) => void;
  onEnqueue: () => void;
  onRetryJob: () => void;
  onCancelJob: () => void;
  onOpenDraft?: () => void;
}

function Loading({ label }: { label: string }): ReactNode {
  return (
    <div className="inbox-processing" role="status" aria-live="polite">
      <div className="inbox-suggest-h">
        <AgentBlob agent="weaver" state="running" size={22} />
        {label}
      </div>
      <div className="inbox-skeleton" aria-hidden="true">
        <span className="sk-line" />
        <span className="sk-line short" />
        <span className="sk-line" />
      </div>
    </div>
  );
}

/** The right-hand reading + triage pane for the selected capture. */
export function DetailPane({
  capture,
  job,
  jobBusy = false,
  canQueue = true,
  preview,
  noteById,
  onAccept,
  onEdit,
  onSkip,
  onRetry,
  onEnqueue,
  onRetryJob,
  onCancelJob,
  onOpenDraft,
}: Props): ReactNode {
  const actions = { onAccept, onEdit, onSkip };
  const provenance = Object.entries(capture.provenance ?? {});

  const renderSuggestion = (): ReactNode => {
    // Demo captures carry a seed suggestion; real ones use the fetched preview.
    if (capture.suggestion) {
      const data: CardData = {
        type: capture.suggestion.type,
        destFolder: capture.suggestion.destFolder,
        title: capture.suggestion.title,
        tags: capture.suggestion.tags,
        links: capture.suggestion.links
          .map((id) => {
            const n = noteById(id);
            return n ? { key: id, title: n.title } : null;
          })
          .filter((x): x is CardLink => x !== null),
      };
      return <SuggestionCard data={data} {...actions} />;
    }

    if (!preview) return <Loading label="Weaver is reading this capture…" />;

    if (preview.status === "error") {
      return (
        <div className="inbox-suggest" role="status">
          <div className="inbox-suggest-h">
            <AgentBlob agent="weaver" state="idle" size={22} />
            Weaver suggestion
          </div>
          <p className="inbox-suggest-err">{preview.message}</p>
          <div className="inbox-suggest-actions">
            <Button size="md" onClick={() => onRetry(capture.id)}>
              retry
            </Button>
          </div>
        </div>
      );
    }

    const p = preview.preview;
    const data: CardData = {
      type: toNodeType(p.note_type),
      destFolder: p.folder,
      title: p.title,
      tags: p.tags,
      links: p.links.map((l) => ({
        key: l.note_id || l.title,
        title: l.title,
        decision: l.decision,
      })),
    };
    return <SuggestionCard data={data} {...actions} />;
  };

  const jobActive =
    job?.status === "queued" ||
    job?.status === "running" ||
    job?.status === "retrying";
  const needsReview = job
    ? job.status === "needs_review"
    : capture.status === "needs_review";
  const failed = job ? job.status === "failed" : capture.status === "failed";
  const completed = job?.status === "completed";
  const cancelled = job?.status === "cancelled";
  const triaging =
    capture.status === "pending" &&
    !jobActive &&
    !needsReview &&
    !failed &&
    !completed;

  return (
    <div className="inbox-detail">
      <div className="inbox-detail-title">{capture.title}</div>
      <div className="inbox-detail-meta">
        <span>{capture.folder}/</span>
        {capture.source && <span>via {capture.source}</span>}
        <span>received {formatDateTime(capture.receivedAt)}</span>
      </div>
      {provenance.length > 0 && (
        <dl className="inbox-provenance" aria-label="Capture provenance">
          {provenance.map(([key, value]) => (
            <div className="inbox-provenance-row" key={key}>
              <dt>{key.replaceAll("_", " ")}</dt>
              <dd>
                {/^https?:\/\//i.test(value) ? (
                  <a href={value} target="_blank" rel="noreferrer">
                    {value}
                  </a>
                ) : (
                  value
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {renderMarkdown(capture.body, { bodyClass: "inbox-detail-body" })}

      {(capture.status === "processing" || job?.status === "running") && (
        <Loading label="Weaver is filing this capture…" />
      )}
      {job?.status === "queued" && (
        <div className="inbox-job-progress" role="status" aria-live="polite">
          <div className="inbox-job-progress-h">
            <span className="status-badge" data-state="queued">
              <span className="pulse-dot" /> queued
            </span>
            Waiting for a worker
          </div>
          <p>
            This capture is safely queued. It will keep its place if Loom
            restarts.
          </p>
          <Button size="md" onClick={onCancelJob} disabled={jobBusy}>
            {jobBusy ? "cancelling…" : "cancel job"}
          </Button>
        </div>
      )}
      {job?.status === "retrying" && (
        <div className="inbox-job-progress" role="status" aria-live="polite">
          <div className="inbox-job-progress-h">
            <span className="status-badge" data-state="retrying">
              <span className="pulse-dot" /> retrying
            </span>
            Attempt {job.attempts + 1} of {job.max_attempts}
          </div>
          <p>
            Loom will retry automatically
            {job.next_attempt_at
              ? ` after ${formatDateTime(job.next_attempt_at)}`
              : " shortly"}
            .
          </p>
          {job.error && <p className="inbox-job-error">{job.error}</p>}
          <Button size="md" onClick={onCancelJob} disabled={jobBusy}>
            {jobBusy ? "cancelling…" : "cancel retry"}
          </Button>
        </div>
      )}
      {needsReview && (
        <div className="inbox-review" role="alert">
          <div className="inbox-review-h">Needs review</div>
          <p>
            A draft note exists, but Sentinel could not safely finish this
            capture. Retry the idempotent pipeline after reviewing the reason,
            or skip it to archive the source capture.
          </p>
          {capture.validationReasons &&
            capture.validationReasons.length > 0 && (
              <ul>
                {capture.validationReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}
          {job?.error && <p className="inbox-review-error">{job.error}</p>}
          <div className="inbox-suggest-actions">
            {onOpenDraft && (
              <Button size="md" onClick={onOpenDraft}>
                open draft note
              </Button>
            )}
            <Button
              variant="amber"
              size="md"
              onClick={onRetryJob}
              disabled={jobBusy}
            >
              {jobBusy ? "queueing…" : "retry processing"}
            </Button>
            <Button size="md" onClick={onSkip}>
              skip
            </Button>
          </div>
        </div>
      )}
      {failed && (
        <div className="inbox-review" role="alert">
          <div className="inbox-review-h">Processing failed</div>
          <p>
            Loom left this capture in the Inbox. You can retry the pipeline or
            archive the capture if it is not useful.
          </p>
          {(job?.error || capture.lastError) && (
            <p className="inbox-review-error">
              {job?.error || capture.lastError}
            </p>
          )}
          <div className="inbox-suggest-actions">
            <Button
              variant="amber"
              size="md"
              onClick={onRetryJob}
              disabled={jobBusy}
            >
              {jobBusy ? "queueing…" : "retry processing"}
            </Button>
            <Button size="md" onClick={onSkip}>
              skip
            </Button>
          </div>
        </div>
      )}
      {cancelled && (
        <div className="inbox-job-progress" role="status">
          <div className="inbox-job-progress-h">Processing cancelled</div>
          <p>The capture is still in your Inbox and can be queued again.</p>
          <Button
            variant="amber"
            size="md"
            onClick={onEnqueue}
            disabled={jobBusy}
          >
            {jobBusy ? "queueing…" : "queue again"}
          </Button>
        </div>
      )}
      {completed && (
        <div
          className="inbox-suggest inbox-filed"
          role="status"
          aria-live="polite"
        >
          <div className="inbox-suggest-h inbox-filed-h">
            ✓ processing complete
          </div>
          <div className="inbox-filed-body">
            {job.note_title
              ? `Filed as ${job.note_title}.`
              : "Loom finished this capture. The Inbox will refresh shortly."}
          </div>
        </div>
      )}
      {triaging && canQueue && !cancelled && (
        <>
          <div className="inbox-queue-option">
            <div>
              <div className="inbox-queue-option-h">Background processing</div>
              <p>Queue the full Loom pipeline and keep working.</p>
            </div>
            <Button
              variant="amber"
              size="md"
              onClick={onEnqueue}
              disabled={jobBusy}
            >
              {jobBusy ? "queueing…" : "queue processing"}
            </Button>
          </div>
          {renderSuggestion()}
        </>
      )}
      {triaging && (!canQueue || cancelled) && renderSuggestion()}
      {capture.status === "done" && (
        <div className="inbox-suggest inbox-filed">
          <div className="inbox-suggest-h inbox-filed-h">✓ filed</div>
          <div className="inbox-filed-body">
            This capture has been processed.
          </div>
        </div>
      )}
    </div>
  );
}
