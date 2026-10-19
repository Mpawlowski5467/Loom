import { useCallback, useState } from "react";
import type { CaptureJob } from "@/api/captures";
import { useApp } from "@/context/app-ctx";
import type { Capture } from "@/data/types";
import { errorText, isDemoCapture } from "./captureHelpers";
import type { useCaptureJobs } from "./useCaptureJobs";

type Jobs = ReturnType<typeof useCaptureJobs>;
const RETRYABLE = new Set(["failed", "needs_review", "cancelled"]);

/** Queue, retry, cancel and prune durable processing jobs, with toasts. */
export function useJobActions(jobs: Jobs, demoMode: boolean) {
  const { captures, pushToast } = useApp();
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const mark = (ids: readonly string[], on: boolean) =>
    setBusy((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  const titleOf = (job: CaptureJob) =>
    captures.find((c) => c.id === job.capture_id)?.title ?? job.capture_id;

  const queue = useCallback(
    async (capture: Capture, force = false): Promise<boolean> => {
      if (demoMode || isDemoCapture(capture) || busy.has(capture.id))
        return false;
      mark([capture.id], true);
      try {
        const existing = jobs.jobForCapture(capture);
        const again = existing && RETRYABLE.has(existing.status);
        if (again) await jobs.retry(existing.id);
        else await jobs.enqueue(capture, force);
        pushToast({
          icon: "↻",
          agent: "weaver",
          body: again
            ? `Queued another attempt for "${capture.title}"`
            : `Queued "${capture.title}" for processing`,
        });
        return true;
      } catch (err) {
        pushToast({
          icon: "⚠",
          agent: "weaver",
          body: `Couldn’t queue "${capture.title}": ${errorText(err)}`,
        });
        return false;
      } finally {
        mark([capture.id], false);
      }
    },
    [busy, demoMode, jobs, pushToast],
  );

  const cancelFor = useCallback(
    async (capture: Capture, job: CaptureJob) => {
      if (busy.has(capture.id)) return;
      mark([capture.id], true);
      try {
        await jobs.cancel(job.id);
        pushToast({
          icon: "×",
          agent: "weaver",
          body: `Cancelled processing for "${capture.title}"`,
        });
      } catch (err) {
        pushToast({
          icon: "⚠",
          agent: "weaver",
          body: `Couldn’t cancel "${capture.title}": ${errorText(err)}`,
        });
      } finally {
        mark([capture.id], false);
      }
    },
    [busy, jobs, pushToast],
  );

  /** Ledger rows re-throw so the ledger can show the error inline. */
  const cancelJob = async (job: CaptureJob) => {
    try {
      await jobs.cancel(job.id);
      pushToast({
        icon: "×",
        agent: "weaver",
        body: `Cancelled processing for "${titleOf(job)}"`,
      });
    } catch (err) {
      pushToast({
        icon: "⚠",
        agent: "weaver",
        body: `Couldn’t cancel "${titleOf(job)}": ${errorText(err)}`,
      });
      throw err;
    }
  };
  const retryJob = async (job: CaptureJob) => {
    try {
      await jobs.retry(job.id);
      pushToast({
        icon: "↻",
        agent: "weaver",
        body: `Queued another attempt for "${titleOf(job)}"`,
      });
    } catch (err) {
      pushToast({
        icon: "⚠",
        agent: "weaver",
        body: `Couldn’t retry "${titleOf(job)}": ${errorText(err)}`,
      });
      throw err;
    }
  };
  const prune = async (olderThanDays?: number) => {
    const deleted = await jobs.pruneHistory(olderThanDays);
    pushToast({
      icon: "✓",
      agent: "archivist",
      body:
        deleted === 1
          ? "Removed 1 processing-history row"
          : `Removed ${deleted} processing-history rows`,
    });
    return deleted;
  };

  /** Queue many captures: fresh ones in a batch, terminal ones retried. */
  const queueMany = async (targets: readonly Capture[]) => {
    if (targets.length === 0) return;
    pushToast({
      icon: "↻",
      agent: "weaver",
      body: `Queueing ${targets.length} capture${targets.length === 1 ? "" : "s"}`,
    });
    const ids = targets.map((c) => c.id);
    mark(ids, true);
    const statusOf = (c: Capture) => jobs.jobForCapture(c)?.status;
    const retry = targets.filter(
      (c) => statusOf(c) === "failed" || statusOf(c) === "needs_review",
    );
    const force = targets.filter((c) => statusOf(c) === "cancelled");
    const fresh = targets.filter(
      (c) => !retry.includes(c) && !force.includes(c),
    );
    const ops: Promise<CaptureJob[]>[] = [];
    if (fresh.length) ops.push(jobs.enqueueBatch(fresh));
    if (force.length) ops.push(jobs.enqueueBatch(force, true));
    ops.push(
      ...retry.map((c) =>
        jobs.retry(jobs.jobForCapture(c)!.id).then((j) => [j]),
      ),
    );
    const results = await Promise.allSettled(ops);
    const queued = results.reduce(
      (n, r) => n + (r.status === "fulfilled" ? r.value.length : 0),
      0,
    );
    mark(ids, false);
    const failed = targets.length - queued;
    if (targets.length > 1 || failed > 0)
      pushToast({
        icon: queued > 0 ? "✓" : "⚠",
        agent: "weaver",
        body:
          failed === 0
            ? `Queued ${queued} captures`
            : `Queued ${queued}; ${failed} failed`,
      });
  };

  return { busy, queue, cancelFor, cancelJob, retryJob, prune, queueMany };
}
