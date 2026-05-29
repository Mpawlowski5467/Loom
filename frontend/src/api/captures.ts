import { apiClient } from "./client";
import type { NoteRecord } from "./notes";
import type { Capture, CaptureStatus } from "../data/types";

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
}

export function listCaptures(signal?: AbortSignal): Promise<CaptureRecord[]> {
  return apiClient.get<CaptureRecord[]>("/api/captures", signal);
}

export interface ProcessResult {
  processed: boolean;
  note_id?: string;
  note_title?: string;
  note_type?: string;
  target_path?: string;
  error?: string;
  linked?: string[];
  suggested?: string[];
  validation?: string;
}

export function processCapture(capturePath: string): Promise<ProcessResult> {
  return apiClient.post<ProcessResult>("/api/captures/process", {
    capture_path: capturePath,
  });
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
    ? cap.filePath.split("/threads/")[1] ?? cap.filePath
    : `${cap.folder}/${cap.id}.md`;
}

export function backendCaptureToFrontend(record: CaptureRecord): Capture {
  return {
    id: record.id || record.file_path,
    title: record.title || "Untitled capture",
    folder: folderFromPath(record.file_path),
    body: record.body || record.preview,
    receivedAt: record.created || record.modified,
    status: captureStatus(record.status),
    filePath: record.file_path,
  };
}

function captureStatus(status: string): CaptureStatus {
  if (status === "done" || status === "processing") return status;
  return "pending";
}

function folderFromPath(path: string): string {
  const parts = path.split("/threads/")[1]?.split("/") ?? [];
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "captures";
}
