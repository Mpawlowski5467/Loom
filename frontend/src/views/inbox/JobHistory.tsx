import { useId, useMemo, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { ConfirmModal } from "../../components/ConfirmModal";
import { JobFilters } from "./JobFilters";
import { JobRow } from "./JobRow";
import type { CaptureJob, CaptureJobStatus } from "../../api/captures";
import type { Capture } from "../../data/types";

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
    <section
      aria-labelledby={`${idPrefix}-title`}
      className="mx-auto flex max-w-4xl flex-col gap-4 px-6 py-6"
    >
      <header>
        <h2
          id={`${idPrefix}-title`}
          className="text-base font-semibold text-foreground"
        >
          Processing jobs
        </h2>
        <p className="text-sm text-muted-foreground">
          Durable activity for this vault, including archived captures.
        </p>
      </header>

      <div role="tablist" aria-label="Job views" className="flex gap-1">
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
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-secondary-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-selected:bg-nav-active aria-selected:text-nav-active-foreground"
          >
            <span>{item.label}</span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {counts[item.id]}
            </span>
          </button>
        ))}
      </div>

      <JobFilters
        segmentLabel={segmentConfig.label}
        statuses={segmentConfig.statuses}
        status={effectiveStatus}
        onStatusChange={setStatusFilter}
        sources={sources}
        source={sourceFilter}
        onSourceChange={setSourceFilter}
        showRetention={segment === "history" && counts.history > 0}
        retention={retention}
        onRetentionChange={setRetention}
        onPrune={() => setConfirmPrune(true)}
      />

      {error && (
        <p role="alert" className="text-sm text-danger-foreground">
          Job updates unavailable: {error}
        </p>
      )}
      {pruneMessage && (
        <p role="status" className="text-sm text-ok-foreground">
          {pruneMessage}
        </p>
      )}

      <div
        id={`${idPrefix}-${segment}-panel`}
        role="tabpanel"
        aria-labelledby={`${idPrefix}-${segment}-tab`}
      >
        {!loaded ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading jobs…
          </p>
        ) : visibleJobs.length === 0 ? (
          <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
            {emptyMessage(segment, effectiveStatus, sourceFilter)}
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {visibleJobs.map((job) => (
              <JobRow
                key={job.id}
                job={job}
                capture={captureById.get(job.capture_id)}
                busy={busyJobs.has(job.id)}
                actionError={actionErrors[job.id]}
                onOpenNote={onOpenNote}
                onCancel={() => void runAction(job, onCancel)}
                onRetry={() => void runAction(job, onRetry)}
              />
            ))}
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
