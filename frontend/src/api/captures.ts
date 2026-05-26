import { apiClient } from "./client";
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
