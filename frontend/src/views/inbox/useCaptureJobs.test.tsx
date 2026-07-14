import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureJob } from "../../api/captures";
import type { Capture } from "../../data/types";
import { useCaptureJobs } from "./useCaptureJobs";

const mocks = vi.hoisted(() => ({
  listCaptureJobs: vi.fn(),
  enqueueCaptureJob: vi.fn(),
  enqueueCaptureJobs: vi.fn(),
  retryCaptureJob: vi.fn(),
  cancelCaptureJob: vi.fn(),
  pruneCaptureJobHistory: vi.fn(),
  subscribeEventDomains: vi.fn(),
  unsubscribe: vi.fn(),
  events: {
    domains: [] as string[],
    listener: null as ((type: string) => void) | null,
  },
}));

vi.mock("../../api/captures", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/captures")>();
  return {
    ...actual,
    listCaptureJobs: mocks.listCaptureJobs,
    enqueueCaptureJob: mocks.enqueueCaptureJob,
    enqueueCaptureJobs: mocks.enqueueCaptureJobs,
    retryCaptureJob: mocks.retryCaptureJob,
    cancelCaptureJob: mocks.cancelCaptureJob,
    pruneCaptureJobHistory: mocks.pruneCaptureJobHistory,
  };
});

vi.mock("../../api/events", () => ({
  subscribeEventDomains: mocks.subscribeEventDomains,
}));

function job(overrides: Partial<CaptureJob> = {}): CaptureJob {
  return {
    id: "job-1",
    capture_id: "capture-1",
    capture_path: "captures/capture-1.md",
    source: "manual",
    status: "queued",
    attempts: 0,
    max_attempts: 3,
    outcome: null,
    created_at: "2026-07-14T12:00:00Z",
    updated_at: "2026-07-14T12:00:00Z",
    ...overrides,
  };
}

function capture(): Capture {
  return {
    id: "capture-1",
    title: "Capture",
    folder: "captures",
    body: "Body",
    receivedAt: "2026-07-14T12:00:00Z",
    status: "pending",
    filePath: "/vault/threads/captures/capture-1.md",
  };
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useCaptureJobs typed refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.listCaptureJobs.mockReset().mockResolvedValue([job()]);
    mocks.enqueueCaptureJob.mockReset();
    mocks.enqueueCaptureJobs.mockReset();
    mocks.retryCaptureJob.mockReset();
    mocks.cancelCaptureJob.mockReset();
    mocks.pruneCaptureJobHistory.mockReset();
    mocks.unsubscribe.mockReset();
    mocks.events.domains = [];
    mocks.events.listener = null;
    mocks.subscribeEventDomains
      .mockReset()
      .mockImplementation(
        (domains: string[], listener: (type: string) => void) => {
          mocks.events.domains = domains;
          mocks.events.listener = listener;
          return mocks.unsubscribe;
        },
      );
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("refreshes only for capture-job events", async () => {
    const { result, unmount } = renderHook(() =>
      useCaptureJobs({ enabled: true }),
    );
    await advance(0);
    expect(result.current.loaded).toBe(true);
    expect(result.current.jobs).toHaveLength(1);
    expect(mocks.events.domains).toEqual(["capture-jobs"]);
    mocks.listCaptureJobs.mockClear();

    act(() => mocks.events.listener?.("capture-changed"));
    await advance(200);
    expect(mocks.listCaptureJobs).not.toHaveBeenCalled();

    act(() => mocks.events.listener?.("capture-job-changed"));
    await advance(149);
    expect(mocks.listCaptureJobs).not.toHaveBeenCalled();
    await advance(1);
    expect(mocks.listCaptureJobs).toHaveBeenCalledTimes(1);
    unmount();
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("uses a slow active-job poll only as a dropped-event reconcile", async () => {
    const { unmount } = renderHook(() => useCaptureJobs({ enabled: true }));
    await advance(0);
    mocks.listCaptureJobs.mockClear();

    await advance(9_999);
    expect(mocks.listCaptureJobs).not.toHaveBeenCalled();
    await advance(1);
    expect(mocks.listCaptureJobs).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("ignores an older refresh that resolves after a newer one and aborts cleanup", async () => {
    let resolveOlder!: (jobs: CaptureJob[]) => void;
    let resolveNewer!: (jobs: CaptureJob[]) => void;
    const signals: AbortSignal[] = [];
    mocks.listCaptureJobs
      .mockReset()
      .mockImplementationOnce((signal: AbortSignal) => {
        signals.push(signal);
        return new Promise<CaptureJob[]>((resolve) => {
          resolveOlder = resolve;
        });
      })
      .mockImplementationOnce((signal: AbortSignal) => {
        signals.push(signal);
        return new Promise<CaptureJob[]>((resolve) => {
          resolveNewer = resolve;
        });
      });

    const { result, unmount } = renderHook(() =>
      useCaptureJobs({ enabled: true }),
    );
    await advance(0);
    expect(mocks.listCaptureJobs).toHaveBeenCalledTimes(1);

    let newerRefresh!: Promise<void>;
    act(() => {
      newerRefresh = result.current.refresh();
    });
    expect(signals[0]?.aborted).toBe(true);
    const newest = job({
      status: "completed",
      outcome: "filed",
      updated_at: "2026-07-14T12:02:00Z",
    });
    resolveNewer([newest]);
    await act(async () => newerRefresh);
    expect(result.current.jobs).toEqual([newest]);

    // The first mock intentionally ignores its AbortSignal and resolves late.
    // Generation ownership still prevents it from replacing the new ledger.
    resolveOlder([job({ updated_at: "2026-07-14T12:01:00Z" })]);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.jobs).toEqual([newest]);

    let cleanupSignal: AbortSignal | undefined;
    mocks.listCaptureJobs.mockImplementationOnce((signal: AbortSignal) => {
      cleanupSignal = signal;
      return new Promise<CaptureJob[]>(() => {});
    });
    act(() => {
      void result.current.refresh();
    });
    unmount();
    expect(cleanupSignal?.aborted).toBe(true);
  });

  it("prevents a refresh started during a mutation from overwriting its result", async () => {
    mocks.listCaptureJobs.mockReset().mockResolvedValueOnce([]);
    let resolveMutation!: (next: CaptureJob) => void;
    let resolveStaleRefresh!: (jobs: CaptureJob[]) => void;
    let staleSignal: AbortSignal | undefined;
    mocks.enqueueCaptureJob.mockImplementationOnce(
      () =>
        new Promise<CaptureJob>((resolve) => {
          resolveMutation = resolve;
        }),
    );

    const { result, unmount } = renderHook(() =>
      useCaptureJobs({ enabled: true }),
    );
    await advance(0);
    mocks.listCaptureJobs.mockImplementationOnce((signal: AbortSignal) => {
      staleSignal = signal;
      return new Promise<CaptureJob[]>((resolve) => {
        resolveStaleRefresh = resolve;
      });
    });

    let mutation!: Promise<CaptureJob>;
    act(() => {
      mutation = result.current.enqueue(capture());
    });
    act(() => {
      void result.current.refresh();
    });
    const mutated = job({
      status: "running",
      updated_at: "2026-07-14T12:03:00Z",
    });
    resolveMutation(mutated);
    await act(async () => mutation);
    expect(staleSignal?.aborted).toBe(true);
    expect(result.current.jobs).toEqual([mutated]);

    // Even a transport mock that disregards abort cannot commit its old list.
    resolveStaleRefresh([job({ updated_at: "2026-07-14T12:01:00Z" })]);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.jobs).toEqual([mutated]);
    unmount();
  });
});
