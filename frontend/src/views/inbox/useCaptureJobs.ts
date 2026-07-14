import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cancelCaptureJob,
  captureRelPath,
  enqueueCaptureJob,
  enqueueCaptureJobs,
  listCaptureJobs,
  pruneCaptureJobHistory,
  retryCaptureJob,
  type CaptureJob,
} from "../../api/captures";
import { subscribeEventDomains } from "../../api/events";
import type { Capture } from "../../data/types";

const JOB_EVENT_DEBOUNCE_MS = 150;
const JOB_RECONCILE_INTERVAL_MS = 10_000;

function normalizeCapturePath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const threadsMarker = "/threads/";
  const markerIndex = normalized.lastIndexOf(threadsMarker);
  return (
    markerIndex >= 0
      ? normalized.slice(markerIndex + threadsMarker.length)
      : normalized
  ).replace(/^\/+/, "");
}

function newerJob(left: CaptureJob, right: CaptureJob): CaptureJob {
  return Date.parse(left.updated_at) >= Date.parse(right.updated_at)
    ? left
    : right;
}

interface UseCaptureJobsOptions {
  enabled: boolean;
}

export interface CaptureJobsState {
  jobs: CaptureJob[];
  loaded: boolean;
  error: string | null;
  jobForCapture: (capture: Capture) => CaptureJob | undefined;
  refresh: (signal?: AbortSignal) => Promise<void>;
  enqueue: (capture: Capture, force?: boolean) => Promise<CaptureJob>;
  enqueueBatch: (captures: Capture[], force?: boolean) => Promise<CaptureJob[]>;
  retry: (jobId: string) => Promise<CaptureJob>;
  cancel: (jobId: string) => Promise<CaptureJob>;
  pruneHistory: (olderThanDays?: number) => Promise<number>;
}

/**
 * Live client-side view of the durable capture-job ledger.
 *
 * Typed SSE is the fast path. A slow reconcile poll is enabled only while a
 * job is active so a dropped terminal event self-heals without amplifying each
 * transition into another request. Mutations update the ledger immediately.
 */
export function useCaptureJobs({
  enabled,
}: UseCaptureJobsOptions): CaptureJobsState {
  const [jobs, setJobs] = useState<CaptureJob[]>([]);
  const [loaded, setLoaded] = useState(!enabled);
  const [error, setError] = useState<string | null>(null);
  const refreshGeneration = useRef(0);
  const refreshController = useRef<AbortController | null>(null);

  const cancelRefresh = useCallback(() => {
    refreshGeneration.current += 1;
    refreshController.current?.abort();
    refreshController.current = null;
  }, []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const generation = refreshGeneration.current + 1;
    refreshGeneration.current = generation;
    refreshController.current?.abort();
    const controller = new AbortController();
    refreshController.current = controller;
    const onCallerAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener("abort", onCallerAbort, { once: true });

    try {
      const next = await listCaptureJobs(controller.signal);
      if (
        controller.signal.aborted ||
        generation !== refreshGeneration.current
      ) {
        return;
      }
      setJobs(next);
      setError(null);
      setLoaded(true);
    } catch (err) {
      if (
        controller.signal.aborted ||
        generation !== refreshGeneration.current
      ) {
        return;
      }
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : String(err));
      setLoaded(true);
    } finally {
      signal?.removeEventListener("abort", onCallerAbort);
      if (refreshController.current === controller) {
        refreshController.current = null;
      }
    }
  }, []);

  const upsert = useCallback((nextJob: CaptureJob) => {
    setLoaded(true);
    setError(null);
    setJobs((current) => [
      nextJob,
      ...current.filter((job) => job.id !== nextJob.id),
    ]);
  }, []);

  useEffect(() => {
    if (!enabled) cancelRefresh();
    return cancelRefresh;
  }, [cancelRefresh, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled) return;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribeEventDomains(["capture-jobs"], (type) => {
      if (type !== "capture-job-changed") return;
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => void refresh(), JOB_EVENT_DEBOUNCE_MS);
    });
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      unsubscribe();
    };
  }, [enabled, refresh]);

  const hasActiveJobs = jobs.some(
    (job) =>
      job.status === "queued" ||
      job.status === "running" ||
      job.status === "retrying",
  );

  useEffect(() => {
    if (!enabled || !hasActiveJobs) return;
    let requestInFlight = false;
    const timer = window.setInterval(() => {
      if (requestInFlight) return;
      requestInFlight = true;
      void refresh().finally(() => {
        requestInFlight = false;
      });
    }, JOB_RECONCILE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [enabled, hasActiveJobs, refresh]);

  const jobsByCapture = useMemo(() => {
    const byKey = new Map<string, CaptureJob>();
    for (const job of jobs) {
      const pathKey = `path:${normalizeCapturePath(job.capture_path)}`;
      const priorByPath = byKey.get(pathKey);
      byKey.set(pathKey, priorByPath ? newerJob(priorByPath, job) : job);
      if (job.capture_id) {
        const idKey = `id:${job.capture_id}`;
        const priorById = byKey.get(idKey);
        byKey.set(idKey, priorById ? newerJob(priorById, job) : job);
      }
    }
    return byKey;
  }, [jobs]);

  const jobForCapture = useCallback(
    (capture: Capture): CaptureJob | undefined =>
      jobsByCapture.get(`id:${capture.id}`) ??
      jobsByCapture.get(
        `path:${normalizeCapturePath(captureRelPath(capture))}`,
      ),
    [jobsByCapture],
  );

  const enqueue = useCallback(
    async (capture: Capture, force = false) => {
      cancelRefresh();
      const path = captureRelPath(capture);
      const job = force
        ? await enqueueCaptureJob(path, true)
        : await enqueueCaptureJob(path);
      cancelRefresh();
      upsert(job);
      return job;
    },
    [cancelRefresh, upsert],
  );

  const enqueueBatch = useCallback(
    async (captures: Capture[], force = false) => {
      cancelRefresh();
      const paths = captures.map((capture) => captureRelPath(capture));
      const next = force
        ? await enqueueCaptureJobs(paths, true)
        : await enqueueCaptureJobs(paths);
      cancelRefresh();
      next.forEach(upsert);
      return next;
    },
    [cancelRefresh, upsert],
  );

  const retry = useCallback(
    async (jobId: string) => {
      cancelRefresh();
      const job = await retryCaptureJob(jobId);
      cancelRefresh();
      upsert(job);
      return job;
    },
    [cancelRefresh, upsert],
  );

  const cancel = useCallback(
    async (jobId: string) => {
      cancelRefresh();
      const job = await cancelCaptureJob(jobId);
      cancelRefresh();
      upsert(job);
      return job;
    },
    [cancelRefresh, upsert],
  );

  const pruneHistory = useCallback(
    async (olderThanDays?: number) => {
      cancelRefresh();
      const result = await pruneCaptureJobHistory(olderThanDays);
      await refresh();
      return result.deleted;
    },
    [cancelRefresh, refresh],
  );

  return {
    jobs,
    loaded,
    error,
    jobForCapture,
    refresh,
    enqueue,
    enqueueBatch,
    retry,
    cancel,
    pruneHistory,
  };
}
