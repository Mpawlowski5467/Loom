import { apiClient } from "./client";
import type {
  BenchmarkRequest,
  BenchmarkResponse,
  HardwareProfile,
  HardwareResponse,
  RecommendationsResponse,
  SaveHardwareResponse,
} from "./types";

export function getHardware(signal?: AbortSignal): Promise<HardwareResponse> {
  return apiClient.get<HardwareResponse>("/api/hardware", signal);
}

/** Persist a profile; the backend re-scans when none is supplied. */
export function saveHardware(
  profile?: HardwareProfile,
  signal?: AbortSignal,
): Promise<SaveHardwareResponse> {
  return apiClient.post<SaveHardwareResponse>(
    "/api/hardware/save",
    profile ? { profile } : {},
    signal,
  );
}

export function getRecommendations(
  signal?: AbortSignal,
): Promise<RecommendationsResponse> {
  return apiClient.get<RecommendationsResponse>(
    "/api/hardware/recommendations",
    signal,
  );
}

/** Backend allows benchmarks up to 60s; outlive the default JSON deadline. */
const BENCHMARK_TIMEOUT_MS = 65_000;

export function runBenchmark(
  body: BenchmarkRequest,
  signal?: AbortSignal,
): Promise<BenchmarkResponse> {
  return apiClient.post<BenchmarkResponse>(
    "/api/hardware/benchmark",
    body,
    signal,
    BENCHMARK_TIMEOUT_MS,
  );
}
