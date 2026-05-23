import { apiClient } from "./client";
import type {
  LoomConfigPublic,
  OnboardingCompleteRequest,
  OnboardingState,
} from "./types";

export function getOnboardingStatus(
  signal?: AbortSignal,
): Promise<OnboardingState> {
  return apiClient.get<OnboardingState>("/api/onboarding/status", signal);
}

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
