import { apiClient } from "./client";
import type { NoteRecord } from "./notes";
import type { Capture, CaptureOutcome, CaptureStatus } from "../data/types";

export interface CaptureRecord {
  id: string;
  title: string;
  type: string;
  tags: string[];
  created: string;
  modified: string;
  author: string;
  source: string;
  status: string;
  preview: string;
  body: string;
  file_path: string;
  external_id?: string;
  provenance?: Record<string, unknown>;
  review_required?: boolean;
  flagged?: boolean;
  validation?: string;
  validation_mode?: string;
  validation_reasons?: string[];
  review_reasons?: string[];
  flag_reasons?: string[];
  draft_note_id?: string;
  draft_note_path?: string;
  last_attempt_outcome?: CaptureOutcome | null;
  last_error?: string;
  last_attempt_at?: string;
  enforcement_outcome?: CaptureOutcome | "" | null;
}

export function listCaptures(signal?: AbortSignal): Promise<CaptureRecord[]> {
  return apiClient.get<CaptureRecord[]>("/api/captures", signal);
}

export interface ProcessResult {
  processed: boolean;
  outcome?: CaptureOutcome;
  note_id?: string;
  note_title?: string;
  note_type?: string;
  target_path?: string;
  error?: string;
  linked?: string[];
  suggested?: string[];
  validation?: string;
  validation_mode?: string;
  validation_reasons?: string[];
  capture_archived?: boolean;
  review_required?: boolean;
  flagged?: boolean;
}

export function processCapture(capturePath: string): Promise<ProcessResult> {
  return apiClient.post<ProcessResult>("/api/captures/process", {
    capture_path: capturePath,
  });
}

export function skipCapture(
  capturePath: string,
  reason?: string,
): Promise<ProcessResult> {
  return apiClient.post<ProcessResult>("/api/captures/skip", {
    capture_path: capturePath,
    ...(reason ? { reason } : {}),
  });
}

export type CaptureJobStatus =
  | "queued"
  | "running"
  | "retrying"
  | "needs_review"
  | "failed"
  | "completed"
  | "cancelled";

/** Durable background work created for an Inbox capture. */
export interface CaptureJob {
  id: string;
  capture_path: string;
  capture_id: string;
  source?: string;
  status: CaptureJobStatus;
  attempts: number;
  max_attempts: number;
  next_attempt_at?: string | null;
  error?: string | null;
  outcome?: CaptureOutcome | null;
  note_id?: string | null;
  note_title?: string | null;
  note_type?: string | null;
  target_path?: string | null;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  finished_at?: string | null;
}

type CaptureJobsResponse = CaptureJob[] | { jobs: CaptureJob[] };

/** List durable capture jobs, newest first. */
export function listCaptureJobs(signal?: AbortSignal): Promise<CaptureJob[]> {
  return apiClient
    .get<CaptureJobsResponse>("/api/captures/jobs", signal)
    .then((response) => (Array.isArray(response) ? response : response.jobs));
}

/** Queue a capture for background processing. */
export function enqueueCaptureJob(
  capturePath: string,
  force = false,
): Promise<CaptureJob> {
  return apiClient.post<CaptureJob>("/api/captures/jobs/enqueue", {
    capture_path: capturePath,
    ...(force ? { force: true } : {}),
  });
}

/** Queue multiple captures in one request (and one rate-limit unit). */
export function enqueueCaptureJobs(
  capturePaths: string[],
  force = false,
): Promise<CaptureJob[]> {
  return apiClient.post<CaptureJob[]>("/api/captures/jobs/enqueue-batch", {
    capture_paths: capturePaths,
    ...(force ? { force: true } : {}),
  });
}

/** Requeue a terminal job while preserving its attempt history. */
export function retryCaptureJob(jobId: string): Promise<CaptureJob> {
  return apiClient.post<CaptureJob>(
    `/api/captures/jobs/${encodeURIComponent(jobId)}/retry`,
  );
}

/** Cancel work that has not started yet (queued or waiting to retry). */
export function cancelCaptureJob(jobId: string): Promise<CaptureJob> {
  return apiClient.post<CaptureJob>(
    `/api/captures/jobs/${encodeURIComponent(jobId)}/cancel`,
  );
}

export interface CaptureJobHistoryPruneResult {
  deleted: number;
}

/**
 * Remove completed/cancelled job ledger rows. Reviewable failures are never
 * pruned by this endpoint. Omit ``olderThanDays`` only for an explicit
 * clear-all-history action.
 */
export function pruneCaptureJobHistory(
  olderThanDays?: number,
): Promise<CaptureJobHistoryPruneResult> {
  const query =
    olderThanDays === undefined
      ? ""
      : `?older_than_days=${encodeURIComponent(String(olderThanDays))}`;
  return apiClient.delete<CaptureJobHistoryPruneResult>(
    `/api/captures/jobs/history${query}`,
  );
}

export type CaptureProcessingMode = "manual" | "trusted" | "all";

export interface CaptureProcessingPolicy {
  mode: CaptureProcessingMode;
  trusted_sources: string[];
  concurrency: number;
  max_retries: number;
  base_backoff_seconds: number;
}

export interface CaptureProcessingPolicyUpdate {
  mode?: CaptureProcessingMode;
  trusted_sources?: string[];
  concurrency?: number;
  max_retries?: number;
  base_backoff_seconds?: number;
}

export function getCaptureProcessingPolicy(
  signal?: AbortSignal,
): Promise<CaptureProcessingPolicy> {
  return apiClient.get<CaptureProcessingPolicy>(
    "/api/captures/processing-policy",
    signal,
  );
}

export function updateCaptureProcessingPolicy(
  update: CaptureProcessingPolicyUpdate,
  signal?: AbortSignal,
): Promise<CaptureProcessingPolicy> {
  return apiClient.patch<CaptureProcessingPolicy>(
    "/api/captures/processing-policy",
    update,
    signal,
  );
}

export interface CreateCapturePayload {
  title: string;
  body: string;
  source?: string;
  tags?: string[];
  external_id?: string;
  provenance?: Record<string, unknown>;
}

export interface CreateCaptureResponse {
  capture: CaptureRecord;
  created: boolean;
  deduplicated: boolean;
  /** Present when the current auto-processing policy queued this arrival. */
  job?: CaptureJob | null;
}

/**
 * Land content in the active vault's Inbox. Connectors should supply a stable
 * ``source`` + ``external_id`` pair so retries are idempotent.
 */
export function createCapture(
  payload: CreateCapturePayload,
  signal?: AbortSignal,
): Promise<CreateCaptureResponse> {
  return apiClient.post<CreateCaptureResponse>(
    "/api/captures",
    payload,
    signal,
  );
}

/** A candidate wikilink Spider proposes for a previewed note. */
export interface PreviewLink {
  note_id: string;
  title: string;
  score: number;
  decision: string; // "auto-linked" | "suggested"
}

/** Weaver's proposed filing for a capture, plus Spider's link candidates. */
export interface CapturePreview {
  note_type: string;
  folder: string;
  title: string;
  tags: string[];
  body: string;
  links: PreviewLink[];
}

/** Optional fields override Weaver's classification (sent when re-previewing edits). */
export interface PreviewRequest {
  capture_path: string;
  note_type?: string;
  folder?: string;
  title?: string;
  tags?: string[];
}

interface PreviewResponse {
  preview: CapturePreview | null;
}

/**
 * Dry-run a capture: returns Weaver's proposed filing + Spider's link
 * candidates without writing anything. ``null`` means an empty capture.
 */
export function previewCapture(
  req: PreviewRequest,
  signal?: AbortSignal,
): Promise<CapturePreview | null> {
  return apiClient
    .post<PreviewResponse>("/api/captures/preview", req, signal)
    .then((r) => r.preview);
}

export interface CommitRequest {
  capture_path: string;
  note_type: string;
  folder: string;
  title: string;
  tags: string[];
  body: string;
}

export interface CommitResult {
  note: NoteRecord;
  linked: string[];
  suggested: string[];
  validation: string;
  validation_mode: string;
  validation_reasons: string[];
  capture_archived: boolean;
  review_required: boolean;
  flagged: boolean;
  outcome?: CaptureOutcome;
}

/** File a previewed (and possibly edited) capture. Writes the note verbatim. */
export function commitCapture(req: CommitRequest): Promise<CommitResult> {
  return apiClient.post<CommitResult>("/api/captures/commit", req);
}

/** The path of a capture relative to ``threads/`` — what the API expects. */
export function captureRelPath(
  cap: Pick<Capture, "filePath" | "folder" | "id">,
): string {
  return cap.filePath
    ? (cap.filePath.split("/threads/")[1] ?? cap.filePath)
    : `${cap.folder}/${cap.id}.md`;
}

export function backendCaptureToFrontend(record: CaptureRecord): Capture {
  return {
    id: record.id || record.file_path,
    title: record.title || "Untitled capture",
    folder: folderFromPath(record.file_path),
    body: record.body || record.preview,
    receivedAt: record.created || record.modified,
    status: captureStatus(
      record.status,
      record.review_required === true ||
        record.enforcement_outcome === "needs_review",
      record.enforcement_outcome,
    ),
    source: record.source || "manual",
    externalId: record.external_id || undefined,
    provenance: normalizeProvenance(record.provenance),
    outcome: record.enforcement_outcome || undefined,
    reviewRequired: record.review_required ?? false,
    flagged: record.flagged ?? false,
    validation: record.validation || undefined,
    validationMode: record.validation_mode || undefined,
    validationReasons:
      record.review_reasons && record.review_reasons.length > 0
        ? record.review_reasons
        : (record.validation_reasons ?? []),
    draftNoteId: record.draft_note_id || undefined,
    draftNotePath: record.draft_note_path || undefined,
    lastAttemptOutcome: record.last_attempt_outcome || undefined,
    lastError: record.last_error || undefined,
    lastAttemptAt: record.last_attempt_at || undefined,
    filePath: record.file_path,
  };
}

function captureStatus(
  status: string,
  reviewRequired = false,
  outcome?: CaptureOutcome | "" | null,
): CaptureStatus {
  if (reviewRequired || status === "needs_review") return "needs_review";
  if (outcome === "failed" || status === "failed") return "failed";
  if (status === "done" || status === "processing") return status;
  return "pending";
}

function normalizeProvenance(
  provenance: Record<string, unknown> | undefined,
): Record<string, string> | undefined {
  if (!provenance) return undefined;
  return Object.fromEntries(
    Object.entries(provenance).map(([key, value]) => {
      if (typeof value === "string") return [key, value];
      if (value === null || value === undefined) return [key, ""];
      if (typeof value === "object") {
        try {
          return [key, JSON.stringify(value)];
        } catch {
          return [key, String(value)];
        }
      }
      return [key, String(value)];
    }),
  );
}

function folderFromPath(path: string): string {
  const parts = path.split("/threads/")[1]?.split("/") ?? [];
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "captures";
}
