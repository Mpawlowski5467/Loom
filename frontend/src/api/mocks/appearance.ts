import {
  APPEARANCE_DEFAULTS,
  normalizeAppearance,
  type AppearanceSettings,
} from "@/theme/appearance";
import { mockDelay } from "./index";

/** Stands in for the vault's config/appearance.yaml for this page session. */
let stored: AppearanceSettings | null = null;

export function mockGetAppearance(): Promise<AppearanceSettings | null> {
  return mockDelay(stored);
}

export function mockPutAppearance(
  settings: AppearanceSettings,
): Promise<AppearanceSettings> {
  stored = normalizeAppearance({ ...APPEARANCE_DEFAULTS, ...settings });
  return mockDelay(stored);
}
