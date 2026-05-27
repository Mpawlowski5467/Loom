import { apiClient } from "./client";

/**
 * Result of POST /api/agents/{name}/run.
 *
 * ``result`` keys vary per-agent and mirror what the corresponding agent's
 * ``run_scheduled`` branch returns. Examples:
 *   archivist → { total_notes, issues, error_count, warning_count }
 *   scribe    → { date, content }
 *   spider    → { notes_scanned, total_auto_linked, total_suggested, total_skipped, reports }
 *   standup   → { recap, date, notes_modified, capture_id, capture_path }
 */
export interface RunAgentResponse {
  agent: string;
  result: Record<string, unknown>;
}

/** Loom-layer agents whose ``run_scheduled`` handler is meaningful to invoke manually. */
export const RUNNABLE_LOOM_AGENTS: ReadonlySet<string> = new Set([
  "archivist",
  "scribe",
  "spider",
]);

export function runAgent(agentName: string): Promise<RunAgentResponse> {
  return apiClient.post<RunAgentResponse>(
    `/api/agents/${encodeURIComponent(agentName)}/run`,
  );
}

/** Translate a per-agent ``result`` dict into a single-line toast-friendly summary. */
export function formatRunResult(
  name: string,
  result: RunAgentResponse["result"],
): string {
  if (name === "archivist") {
    const total = Number(result["total_notes"] ?? 0);
    const errors = Number(result["error_count"] ?? 0);
    const warnings = Number(result["warning_count"] ?? 0);
    return `Archivist audited ${total} notes (${errors} errors, ${warnings} warnings)`;
  }
  if (name === "scribe") {
    const date = String(result["date"] ?? "");
    const content = String(result["content"] ?? "");
    const words = content ? content.trim().split(/\s+/).length : 0;
    return date
      ? `Scribe wrote daily-log for ${date} (${words} words)`
      : "Scribe finished — no content";
  }
  if (name === "spider") {
    const scanned = Number(result["notes_scanned"] ?? 0);
    const auto = Number(result["total_auto_linked"] ?? 0);
    const suggested = Number(result["total_suggested"] ?? 0);
    return `Spider scanned ${scanned} notes, auto-linked ${auto}, suggested ${suggested}`;
  }
  return `${name} finished`;
}
