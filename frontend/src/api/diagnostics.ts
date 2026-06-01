import { apiClient } from "./client";

export interface DiagnosticsResponse {
  app_version: string;
  python_version: string;
  vault_path: string;
  providers_configured: string[];
  started_at: string;
  build_date: string | null;
  log_path: string;
}

export interface HealthResponse {
  ok: boolean;
  components: Record<
    string,
    { ready: boolean; details?: string; count?: number; unindexed?: number }
  >;
}

export function getDiagnostics(
  signal?: AbortSignal,
): Promise<DiagnosticsResponse> {
  return apiClient.get<DiagnosticsResponse>("/api/diagnostics", signal);
}

export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return apiClient.get<HealthResponse>("/api/health", signal);
}
