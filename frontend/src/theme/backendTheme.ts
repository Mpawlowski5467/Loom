import type { BackendThemeName } from "@/api/types";
import type { ThemeId } from "./registry";

/**
 * The backend's ThemeName enum still lists the pre-shadcn themes, and
 * onboarding must send one of them. Map each new theme to its nearest old
 * one; the real appearance lives in the vault's appearance settings.
 * (Remove once the backend accepts the new ids — see ui-backend-gaps.md.)
 */
const BACKEND_THEME: Record<ThemeId, BackendThemeName> = {
  graphite: "midnight",
  paper: "porcelain",
  midnight: "midnight",
  forest: "lagoon",
  linen: "paper",
  "high-contrast": "midnight",
};

export function backendThemeName(theme: ThemeId): BackendThemeName {
  return BACKEND_THEME[theme];
}
