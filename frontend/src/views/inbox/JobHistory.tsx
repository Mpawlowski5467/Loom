import { useId, useMemo, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { ConfirmModal } from "../../components/ConfirmModal";
import { Button } from "../../components/primitives/Button";
import type { CaptureJob, CaptureJobStatus } from "../../api/captures";
import type { Capture } from "../../data/types";
import { formatDateTime } from "../../data/formatDate";

type JobSegment = "active" | "review" | "history";

const SEGMENTS: Array<{
  id: JobSegment;
  label: string;
  statuses: readonly CaptureJobStatus[];
}> = [
  {
    id: "active",
    label: "Active",
    statuses: ["queued", "running", "retrying"],
  },
  { id: "review", label: "Review", statuses: ["needs_review", "failed"] },
  { id: "history", label: "History", statuses: ["completed", "cancelled"] },
];

interface Props {
  jobs: CaptureJob[];
  captures: Capture[];
  loaded: boolean;
  error: string | null;
  onOpenNote: (noteId: string) => void;
  onCancel: (job: CaptureJob) => Promise<void>;
  onRetry: (job: CaptureJob) => Promise<void>;
  onPruneHistory: (olderThanDays?: number) => Promise<number>;
}

/** Durable processing ledger, including rows whose source capture is archived. */
export function JobHistory({
  jobs,
  captures,
  loaded,
  error,
  onOpenNote,
  onCancel,
  onRetry,
  onPruneHistory,
}: Props): ReactNode {
  const idPrefix = useId();
  const [segment, setSegment] = useState<JobSegment>("active");
  const [statusFilter, setStatusFilter] = useState<"all" | CaptureJobStatus>(
    "all",
  );
  const [sourceFilter, setSourceFilter] = useState("all");
  const [retention, setRetention] = useState("30");
  const [confirmPrune, setConfirmPrune] = useState(false);
  const [pruneMessage, setPruneMessage] = useState("");
  const [busyJobs, setBusyJobs] = useState<Set<string>>(new Set());
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});

  const captureById = useMemo(
    () => new Map(captures.map((capture) => [capture.id, capture])),
    [captures],
  );
  const segmentConfig = SEGMENTS.find((item) => item.id === segment)!;
  const effectiveStatus = segmentConfig.statuses.includes(
    statusFilter as CaptureJobStatus,
  )
    ? statusFilter
    : "all";

  const sources = useMemo(
    () =>
      Array.from(
        new Set(jobs.map((job) => (job.source ?? "").trim() || "unknown")),
      ).sort((left, right) => left.localeCompare(right)),
    [jobs],
  );

  const counts = useMemo(
    () =>
      Object.fromEntries(
        SEGMENTS.map((item) => [
          item.id,
          jobs.filter((job) => item.statuses.includes(job.status)).length,
        ]),
      ) as Record<JobSegment, number>,
    [jobs],
  );

  const visibleJobs = useMemo(
    () =>
      jobs.filter((job) => {
        if (!segmentConfig.statuses.includes(job.status)) return false;
        if (effectiveStatus !== "all" && job.status !== effectiveStatus) {
          return false;
        }
        const source = (job.source ?? "").trim() || "unknown";
        return sourceFilter === "all" || source === sourceFilter;
      }),
    [effectiveStatus, jobs, segmentConfig.statuses, sourceFilter],
  );

  const selectSegment = (next: JobSegment) => {
    setSegment(next);
    setStatusFilter("all");
  };

  const onTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % SEGMENTS.length;
    if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + SEGMENTS.length) % SEGMENTS.length;
    }
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = SEGMENTS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = SEGMENTS[nextIndex]!;
    selectSegment(next.id);
    const tabList = event.currentTarget.parentElement;
    requestAnimationFrame(() => {
      tabList
        ?.querySelector<HTMLButtonElement>(`[data-job-segment="${next.id}"]`)
        ?.focus();
    });
  };

  const runAction = async (
    job: CaptureJob,
    action: (job: CaptureJob) => Promise<void>,
  ) => {
    if (busyJobs.has(job.id)) return;
    setBusyJobs((current) => new Set(current).add(job.id));
    setActionErrors((current) => {
      const next = { ...current };
      delete next[job.id];
      return next;
    });
    try {
      await action(job);
    } catch (err) {
      setActionErrors((current) => ({
        ...current,
        [job.id]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setBusyJobs((current) => {
        const next = new Set(current);
        next.delete(job.id);
        return next;
      });
    }
  };

  const retentionDays = retention === "all" ? undefined : Number(retention);
  const retentionDescription =
    retentionDays === undefined
      ? "all completed and cancelled processing history"
      : `completed and cancelled processing history older than ${retentionDays} days`;

  return (
    <section className="inbox-job-ledger" aria-labelledby={`${idPrefix}-title`}>
      <div className="inbox-job-ledger-head">
        <div>
          <h2 id={`${idPrefix}-title`}>Processing jobs</h2>
          <p>Durable activity for this vault, including archived captures.</p>
        </div>
      </div>

      <div className="inbox-job-tabs" role="tablist" aria-label="Job views">
        {SEGMENTS.map((item, index) => (
          <button
            key={item.id}
            id={`${idPrefix}-${item.id}-tab`}
            type="button"
            role="tab"
            data-job-segment={item.id}
            aria-selected={segment === item.id}
            aria-controls={`${idPrefix}-${item.id}-panel`}
            tabIndex={segment === item.id ? 0 : -1}
            onClick={() => selectSegment(item.id)}
            onKeyDown={(event) => onTabKeyDown(event, index)}
          >
            <span>{item.label}</span>
            <span className="inbox-job-tab-count">{counts[item.id]}</span>
          </button>
        ))}
      </div>

      <div className="inbox-job-filters">
        <label>
          <span>Status</span>
          <select
            aria-label="Filter jobs by status"
            value={effectiveStatus}
            onChange={(event) =>
              setStatusFilter(event.target.value as "all" | CaptureJobStatus)
            }
          >
            <option value="all">All {segmentConfig.label.toLowerCase()}</option>
            {segmentConfig.statuses.map((status) => (
              <option key={status} value={status}>
                {statusLabel(status)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Source</span>
          <select
            aria-label="Filter jobs by source"
            value={sourceFilter}
            onChange={(event) => setSourceFilter(event.target.value)}
          >
            <option value="all">All sources</option>
            {sources.map((source) => (
              <option key={source} value={source}>
                {source}
              </option>
            ))}
          </select>
        </label>
        {segment === "history" && counts.history > 0 && (
          <div className="inbox-job-retention">
            <label>
              <span>Retain</span>
              <select
                aria-label="History retention window"
                value={retention}
                onChange={(event) => setRetention(event.target.value)}
              >
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
                <option value="all">Clear all</option>
              </select>
            </label>
            <Button size="sm" onClick={() => setConfirmPrune(true)}>
              Remove older
            </Button>
          </div>
        )}
      </div>

      {error && (
        <div className="inbox-jobs-error inbox-job-ledger-error" role="alert">
          Job updates unavailable: {error}
        </div>
      )}
      {pruneMessage && (
        <div className="inbox-job-prune-result" role="status">
          {pruneMessage}
        </div>
      )}

      <div
        id={`${idPrefix}-${segment}-panel`}
        role="tabpanel"
        aria-labelledby={`${idPrefix}-${segment}-tab`}
        className="inbox-job-panel"
      >
        {!loaded ? (
          <div className="inbox-empty" role="status">
            Loading jobs…
          </div>
        ) : visibleJobs.length === 0 ? (
          <div className="inbox-empty inbox-job-empty">
            {emptyMessage(segment, effectiveStatus, sourceFilter)}
          </div>
        ) : (
          <ol className="inbox-job-list">
            {visibleJobs.map((job) => {
              const capture = captureById.get(job.capture_id);
              const sourceAvailable = Boolean(capture);
              const busy = busyJobs.has(job.id);
              const retryable =
                job.status === "failed" ||
                job.status === "needs_review" ||
                job.status === "cancelled";
              const cancellable =
                job.status === "queued" || job.status === "retrying";
              return (
                <li key={job.id}>
                  <article className="inbox-job-row">
                    <div className="inbox-job-row-head">
                      <div>
                        <h3>{capture?.title ?? captureName(job)}</h3>
                        <div
                          className="inbox-job-path"
                          title={job.capture_path}
                        >
                          {displayPath(job.capture_path)}
                        </div>
                      </div>
                      <span
                        className="status-badge"
                        data-state={badgeState(job.status)}
                      >
                        <span className="pulse-dot" />
                        {statusLabel(job.status)}
                      </span>
                    </div>
                    <dl className="inbox-job-facts">
                      <div>
                        <dt>Source</dt>
                        <dd>{job.source || "unknown"}</dd>
                      </div>
                      <div>
                        <dt>Attempts</dt>
                        <dd>
                          {job.attempts} of {job.max_attempts}
                        </dd>
                      </div>
                      <div>
                        <dt>Updated</dt>
                        <dd title={job.updated_at}>
                          {formatDateTime(job.updated_at)} UTC
                        </dd>
                      </div>
                      <div>
                        <dt>Outcome</dt>
                        <dd>{job.outcome ? statusLabel(job.outcome) : "—"}</dd>
                      </div>
                    </dl>
                    {job.note_title && (
                      <div className="inbox-job-note-result">
                        Filed as <strong>{job.note_title}</strong>
                        {job.target_path && (
                          <span title={job.target_path}>
                            {displayPath(job.target_path)}
                          </span>
                        )}
                      </div>
                    )}
                    {job.error && (
                      <div className="inbox-job-row-error">{job.error}</div>
                    )}
                    {actionErrors[job.id] && (
                      <div className="inbox-job-row-error" role="alert">
                        {actionErrors[job.id]}
                      </div>
                    )}
                    <div className="inbox-job-row-actions">
                      {job.note_id && (
                        <Button
                          size="sm"
                          onClick={() => onOpenNote(job.note_id!)}
                        >
                          Open note
                        </Button>
                      )}
                      {cancellable && (
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() => void runAction(job, onCancel)}
                        >
                          {busy ? "Cancelling…" : "Cancel"}
                        </Button>
                      )}
                      {retryable && sourceAvailable && (
                        <Button
                          size="sm"
                          variant="amber"
                          disabled={busy}
                          onClick={() => void runAction(job, onRetry)}
                        >
                          {busy ? "Queueing…" : "Retry"}
                        </Button>
                      )}
                      {retryable && !sourceAvailable && (
                        <span className="inbox-job-source-gone">
                          Source capture archived
                        </span>
                      )}
                    </div>
                  </article>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {confirmPrune && (
        <ConfirmModal
          title="Remove processing history?"
          body={`This removes ${retentionDescription}. It does not delete captures or filed notes.`}
          confirmLabel="Remove history"
          onConfirm={async () => {
            const deleted = await onPruneHistory(retentionDays);
            setPruneMessage(
              deleted === 1 ? "Removed 1 job." : `Removed ${deleted} jobs.`,
            );
          }}
          onClose={() => setConfirmPrune(false)}
        />
      )}
    </section>
  );
}

function captureName(job: CaptureJob): string {
  const filename = job.capture_path.replaceAll("\\", "/").split("/").pop();
  return filename?.replace(/\.md$/i, "") || job.capture_id || "Capture";
}

function displayPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const marker = "/threads/";
  const index = normalized.lastIndexOf(marker);
  return index >= 0 ? normalized.slice(index + marker.length) : normalized;
}

function statusLabel(status: CaptureJobStatus | string): string {
  if (status === "needs_review") return "needs review";
  return status.replaceAll("_", " ");
}

function badgeState(
  status: CaptureJobStatus,
): "queued" | "running" | "retrying" | "review" | "success" | "idle" {
  if (status === "queued") return "queued";
  if (status === "running") return "running";
  if (status === "retrying") return "retrying";
  if (status === "failed" || status === "needs_review") return "review";
  if (status === "completed") return "success";
  return "idle";
}

function emptyMessage(
  segment: JobSegment,
  status: "all" | CaptureJobStatus,
  source: string,
): string {
  if (status !== "all" || source !== "all") {
    return "No jobs match these filters.";
  }
  if (segment === "active") return "No processing jobs are active.";
  if (segment === "review") return "No jobs need attention.";
  return "No completed processing history yet.";
}
