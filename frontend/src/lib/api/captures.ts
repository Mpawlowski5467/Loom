import { request } from "./common";

export interface CaptureItem {
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
  file_path: string;
}

export interface ProcessResult {
  processed: boolean;
  note_id: string;
  note_title: string;
  note_type: string;
  target_path: string;
  error: string;
}

export interface ProcessAllResult {
  total: number;
  processed: number;
  results: ProcessResult[];
}

export function fetchCaptures(): Promise<CaptureItem[]> {
  return request<CaptureItem[]>("/api/captures");
}

export function processCapture(capturePath: string): Promise<ProcessResult> {
  return request<ProcessResult>("/api/captures/process", {
    method: "POST",
    body: JSON.stringify({ capture_path: capturePath }),
  });
}

export function processAllCaptures(): Promise<ProcessAllResult> {
  return request<ProcessAllResult>("/api/captures/process-all", {
    method: "POST",
  });
}
