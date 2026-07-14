import { describe, it, expect, vi, afterEach } from "vitest";
import { apiClient } from "./client";
import {
  captureRelPath,
  backendCaptureToFrontend,
  cancelCaptureJob,
  createCapture,
  enqueueCaptureJob,
  enqueueCaptureJobs,
  getCaptureProcessingPolicy,
  listCaptureJobs,
  pruneCaptureJobHistory,
  previewCapture,
  retryCaptureJob,
  skipCapture,
  updateCaptureProcessingPolicy,
  type CaptureJob,
  type CaptureRecord,
} from "./captures";

function mkJob(overrides: Partial<CaptureJob> = {}): CaptureJob {
  return {
    id: "job_1",
    capture_id: "cap_1",
    capture_path: "captures/cap_1.md",
    source: "manual",
    status: "queued",
    attempts: 0,
    max_attempts: 3,
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
    ...overrides,
  };
}

function mkRecord(overrides: Partial<CaptureRecord> = {}): CaptureRecord {
  return {
    id: "cap_1",
    title: "A capture",
    type: "capture",
    tags: [],
    created: "2026-05-01T00:00:00Z",
    modified: "2026-05-02T00:00:00Z",
    author: "user",
    source: "manual",
    status: "pending",
    preview: "preview text",
    body: "full body",
    file_path: "/home/u/.loom/vaults/main/threads/captures/cap_1.md",
    ...overrides,
  };
}

describe("captureRelPath", () => {
  it("returns the path relative to threads/ when filePath is set", () => {
    expect(
      captureRelPath({
        id: "cap_1",
        folder: "captures",
        filePath: "/x/.loom/vaults/main/threads/captures/cap_1.md",
      }),
    ).toBe("captures/cap_1.md");
  });

  it("falls back to folder/id when filePath has no threads/ segment", () => {
    expect(
      captureRelPath({
        id: "cap_9",
        folder: "captures",
        filePath: "/weird/path.md",
      }),
    ).toBe("/weird/path.md");
  });

  it("synthesizes folder/id.md when filePath is empty", () => {
    expect(captureRelPath({ id: "cap_2", folder: "inbox", filePath: "" })).toBe(
      "inbox/cap_2.md",
    );
  });
});

describe("backendCaptureToFrontend", () => {
  it("maps a well-formed record straight across", () => {
    const cap = backendCaptureToFrontend(mkRecord());
    expect(cap).toEqual({
      id: "cap_1",
      title: "A capture",
      folder: "captures",
      body: "full body",
      receivedAt: "2026-05-01T00:00:00Z",
      status: "pending",
      source: "manual",
      externalId: undefined,
      provenance: undefined,
      outcome: undefined,
      reviewRequired: false,
      flagged: false,
      validation: undefined,
      validationMode: undefined,
      validationReasons: [],
      draftNoteId: undefined,
      draftNotePath: undefined,
      lastAttemptOutcome: undefined,
      lastError: undefined,
      lastAttemptAt: undefined,
      filePath: "/home/u/.loom/vaults/main/threads/captures/cap_1.md",
    });
  });

  it("derives the folder from a nested path under threads/", () => {
    const cap = backendCaptureToFrontend(
      mkRecord({
        file_path: "/v/threads/projects/loom/cap_x.md",
      }),
    );
    expect(cap.folder).toBe("projects/loom");
  });

  it("defaults the folder to captures when the path is flat", () => {
    const cap = backendCaptureToFrontend(
      mkRecord({ file_path: "/v/threads/loose.md" }),
    );
    expect(cap.folder).toBe("captures");
  });

  it("falls back to the file path for a missing id", () => {
    const cap = backendCaptureToFrontend(
      mkRecord({ id: "", file_path: "/p/x.md" }),
    );
    expect(cap.id).toBe("/p/x.md");
  });

  it("supplies a placeholder title when none is given", () => {
    expect(backendCaptureToFrontend(mkRecord({ title: "" })).title).toBe(
      "Untitled capture",
    );
  });

  it("uses the preview as the body when body is empty", () => {
    const cap = backendCaptureToFrontend(
      mkRecord({ body: "", preview: "just a preview" }),
    );
    expect(cap.body).toBe("just a preview");
  });

  it("uses modified as the timestamp when created is absent", () => {
    const cap = backendCaptureToFrontend(
      mkRecord({ created: "", modified: "2026-05-02T00:00:00Z" }),
    );
    expect(cap.receivedAt).toBe("2026-05-02T00:00:00Z");
  });

  it("passes through done and processing statuses, normalizing the rest to pending", () => {
    expect(backendCaptureToFrontend(mkRecord({ status: "done" })).status).toBe(
      "done",
    );
    expect(
      backendCaptureToFrontend(mkRecord({ status: "processing" })).status,
    ).toBe("processing");
    expect(
      backendCaptureToFrontend(mkRecord({ status: "garbage" })).status,
    ).toBe("pending");
    expect(backendCaptureToFrontend(mkRecord({ status: "" })).status).toBe(
      "pending",
    );
  });

  it("maps durable review state and connector provenance", () => {
    const cap = backendCaptureToFrontend(
      mkRecord({
        source: "bridge:gmail",
        external_id: "msg-42",
        provenance: {
          url: "https://mail.example.test/42",
          attempt: 2,
        },
        enforcement_outcome: "needs_review",
        review_required: true,
        review_reasons: ["Sentinel unavailable"],
        validation: "unavailable",
        validation_mode: "unavailable",
        draft_note_id: "draft-42",
        draft_note_path: "/v/threads/topics/draft-42.md",
      }),
    );

    expect(cap).toMatchObject({
      status: "needs_review",
      source: "bridge:gmail",
      externalId: "msg-42",
      provenance: {
        url: "https://mail.example.test/42",
        attempt: "2",
      },
      outcome: "needs_review",
      reviewRequired: true,
      validation: "unavailable",
      validationMode: "unavailable",
      validationReasons: ["Sentinel unavailable"],
      draftNoteId: "draft-42",
      draftNotePath: "/v/threads/topics/draft-42.md",
    });
  });

  it("maps a durable retryable processing failure", () => {
    const cap = backendCaptureToFrontend(
      mkRecord({
        enforcement_outcome: "failed",
        last_attempt_outcome: "failed",
        last_error: "Provider timed out",
        last_attempt_at: "2026-05-02T12:00:00Z",
      }),
    );

    expect(cap).toMatchObject({
      status: "failed",
      outcome: "failed",
      lastAttemptOutcome: "failed",
      lastError: "Provider timed out",
      lastAttemptAt: "2026-05-02T12:00:00Z",
    });
  });
});

describe("capture lifecycle writes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates captures through the incoming gateway", async () => {
    const response = {
      capture: mkRecord({ source: "bridge:browser", external_id: "page-1" }),
      created: true,
      deduplicated: false,
    };
    const spy = vi.spyOn(apiClient, "post").mockResolvedValue(response);

    await expect(
      createCapture({
        title: "Useful page",
        body: "Captured body",
        source: "bridge:browser",
        external_id: "page-1",
        provenance: { url: "https://example.test" },
      }),
    ).resolves.toEqual(response);
    expect(spy).toHaveBeenCalledWith(
      "/api/captures",
      {
        title: "Useful page",
        body: "Captured body",
        source: "bridge:browser",
        external_id: "page-1",
        provenance: { url: "https://example.test" },
      },
      undefined,
    );
  });

  it("archives a skipped capture instead of only hiding it locally", async () => {
    const response = {
      processed: false,
      outcome: "skipped" as const,
      capture_archived: true,
    };
    const spy = vi.spyOn(apiClient, "post").mockResolvedValue(response);

    await expect(
      skipCapture("captures/cap_1.md", "Not useful"),
    ).resolves.toEqual(response);
    expect(spy).toHaveBeenCalledWith("/api/captures/skip", {
      capture_path: "captures/cap_1.md",
      reason: "Not useful",
    });
  });
});

describe("capture processing jobs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists jobs from either the raw or enveloped response shape", async () => {
    const job = mkJob();
    const spy = vi
      .spyOn(apiClient, "get")
      .mockResolvedValueOnce([job])
      .mockResolvedValueOnce({ jobs: [job] });

    await expect(listCaptureJobs()).resolves.toEqual([job]);
    await expect(listCaptureJobs()).resolves.toEqual([job]);
    expect(spy).toHaveBeenNthCalledWith(1, "/api/captures/jobs", undefined);
  });

  it("enqueues one capture or a batch", async () => {
    const job = mkJob();
    const spy = vi.spyOn(apiClient, "post").mockResolvedValue(job);

    await enqueueCaptureJob("captures/cap_1.md");
    expect(spy).toHaveBeenLastCalledWith("/api/captures/jobs/enqueue", {
      capture_path: "captures/cap_1.md",
    });

    spy.mockResolvedValue([job]);
    await enqueueCaptureJobs(["captures/cap_1.md"], true);
    expect(spy).toHaveBeenLastCalledWith("/api/captures/jobs/enqueue-batch", {
      capture_paths: ["captures/cap_1.md"],
      force: true,
    });
  });

  it("retries and cancels jobs by encoded id", async () => {
    const spy = vi.spyOn(apiClient, "post").mockResolvedValue(mkJob());

    await retryCaptureJob("job/1");
    expect(spy).toHaveBeenLastCalledWith("/api/captures/jobs/job%2F1/retry");
    await cancelCaptureJob("job/1");
    expect(spy).toHaveBeenLastCalledWith("/api/captures/jobs/job%2F1/cancel");
  });

  it("applies a bounded or clear-all history retention request", async () => {
    const spy = vi.spyOn(apiClient, "delete").mockResolvedValue({ deleted: 2 });

    await expect(pruneCaptureJobHistory(30)).resolves.toEqual({ deleted: 2 });
    expect(spy).toHaveBeenLastCalledWith(
      "/api/captures/jobs/history?older_than_days=30",
    );

    await pruneCaptureJobHistory();
    expect(spy).toHaveBeenLastCalledWith("/api/captures/jobs/history");
  });

  it("loads and patches the auto-processing policy", async () => {
    const policy = {
      mode: "trusted" as const,
      trusted_sources: ["bridge:gmail"],
      concurrency: 2,
      max_retries: 3,
      base_backoff_seconds: 5,
    };
    const getSpy = vi.spyOn(apiClient, "get").mockResolvedValue(policy);
    const patchSpy = vi.spyOn(apiClient, "patch").mockResolvedValue(policy);

    await expect(getCaptureProcessingPolicy()).resolves.toEqual(policy);
    expect(getSpy).toHaveBeenCalledWith(
      "/api/captures/processing-policy",
      undefined,
    );
    await updateCaptureProcessingPolicy({
      mode: "trusted",
      trusted_sources: ["bridge:gmail"],
    });
    expect(patchSpy).toHaveBeenCalledWith(
      "/api/captures/processing-policy",
      { mode: "trusted", trusted_sources: ["bridge:gmail"] },
      undefined,
    );
  });
});

describe("previewCapture", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("unwraps the preview field from the response envelope", async () => {
    const preview = {
      note_type: "topic",
      folder: "topics",
      title: "T",
      tags: [],
      body: "b",
      links: [],
    };
    const spy = vi.spyOn(apiClient, "post").mockResolvedValue({ preview });
    const result = await previewCapture({ capture_path: "captures/cap_1.md" });
    expect(result).toEqual(preview);
    expect(spy).toHaveBeenCalledWith(
      "/api/captures/preview",
      { capture_path: "captures/cap_1.md" },
      undefined,
    );
  });

  it("returns null for an empty capture", async () => {
    vi.spyOn(apiClient, "post").mockResolvedValue({ preview: null });
    const result = await previewCapture({ capture_path: "captures/empty.md" });
    expect(result).toBeNull();
  });
});
