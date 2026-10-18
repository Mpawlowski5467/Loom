import {
  normalizeAppearance,
  type AppearanceSettings,
} from "@/theme/appearance";
import { ApiError, apiClient } from "./client";
import { MOCKS_ENABLED } from "./mocks";
import { mockGetAppearance, mockPutAppearance } from "./mocks/appearance";

/**
 * Per-vault appearance settings (`config/appearance.yaml`).
 *
 * BACKEND GAP: `GET/PUT /api/settings/appearance` doesn't exist yet (see
 * docs/ui-backend-gaps.md). Until it does, a 404/405 marks the endpoint
 * unsupported for the session and the UI keeps settings in localStorage;
 * `VITE_LOOM_MOCKS=1` serves it from memory instead.
 */

const PATH = "/api/settings/appearance";

let unsupported = false;

function isMissingRoute(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status === 405);
}

/** Whether the backend has shown it can't store appearance settings. */
export function appearanceEndpointUnsupported(): boolean {
  return !MOCKS_ENABLED && unsupported;
}

/** The vault's saved settings; null when none are saved or unsupported. */
export async function getAppearance(
  signal?: AbortSignal,
): Promise<AppearanceSettings | null> {
  if (MOCKS_ENABLED) return mockGetAppearance();
  if (unsupported) return null;
  try {
    const raw = await apiClient.get<unknown>(PATH, signal);
    return raw ? normalizeAppearance(raw) : null;
  } catch (err) {
    if (isMissingRoute(err)) {
      unsupported = true;
      return null;
    }
    throw err;
  }
}

/** Save settings to the vault. Resolves false when the backend can't. */
export async function putAppearance(
  settings: AppearanceSettings,
): Promise<boolean> {
  if (MOCKS_ENABLED) {
    await mockPutAppearance(settings);
    return true;
  }
  if (unsupported) return false;
  try {
    await apiClient.put<unknown>(PATH, settings);
    return true;
  } catch (err) {
    if (isMissingRoute(err)) {
      unsupported = true;
      return false;
    }
    throw err;
  }
}

/** Test hook: forget a previous 404. */
export function resetAppearanceSupport(): void {
  unsupported = false;
}
