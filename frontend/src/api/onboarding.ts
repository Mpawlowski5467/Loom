import { apiClient } from "./client";
import type { LoomConfigPublic, OnboardingCompleteRequest } from "./types";

export function completeOnboarding(
  payload: OnboardingCompleteRequest,
  signal?: AbortSignal,
): Promise<LoomConfigPublic> {
  return apiClient.post<LoomConfigPublic>(
    "/api/onboarding/complete",
    payload,
    signal,
  );
}

export function resetOnboarding(
  signal?: AbortSignal,
): Promise<LoomConfigPublic> {
  return apiClient.post<LoomConfigPublic>("/api/onboarding/reset", {}, signal);
}
