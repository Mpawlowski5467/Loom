import type { CaptureJob, CaptureJobStatus } from "@/api/captures";

export function captureName(job: CaptureJob): string {
  const filename = job.capture_path.replaceAll("\\", "/").split("/").pop();
  return filename?.replace(/\.md$/i, "") || job.capture_id || "Capture";
}

export function displayPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const marker = "/threads/";
  const index = normalized.lastIndexOf(marker);
  return index >= 0 ? normalized.slice(index + marker.length) : normalized;
}

export function statusLabel(status: CaptureJobStatus | string): string {
  if (status === "needs_review") return "needs review";
  return status.replaceAll("_", " ");
}

export function failureLabel(kind: CaptureJob["failure_kind"]): string {
  if (kind === "provider_transient") return "Provider temporarily unavailable";
  if (kind === "provider_configuration")
    return "Provider setup needs attention";
  if (kind === "schema_review") return "Draft needs review";
  if (kind === "stalled") return "Interrupted step recovered";
  if (kind === "source_missing") return "Source capture unavailable";
  return "Recommended next action";
}

export function badgeState(
  status: CaptureJobStatus,
): "queued" | "running" | "retrying" | "review" | "success" | "idle" {
  if (status === "queued") return "queued";
  if (status === "running") return "running";
  if (status === "retrying") return "retrying";
  if (status === "failed" || status === "needs_review") return "review";
  if (status === "completed") return "success";
  return "idle";
}
