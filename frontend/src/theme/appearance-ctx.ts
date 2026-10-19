import { createContext, useContext } from "react";
import type { AppearanceSettings } from "./appearance";
import type { ThemeId, ThemeMode } from "./registry";

export interface AppearanceContextValue {
  settings: AppearanceSettings;
  /** The theme on screen (follow-system and `?theme=` already applied). */
  resolvedTheme: ThemeId;
  mode: ThemeMode;
  /** Where changes are saved: the vault via the API, or only this device. */
  savedTo: "vault" | "device";
  update: (patch: Partial<AppearanceSettings>) => void;
  /** Pick a theme explicitly: stops following the system and remembers it
   *  as the theme for its mode, so the quick toggle comes back to it. */
  setTheme: (id: ThemeId) => void;
  /** Flip between the user's dark and light themes. */
  toggleMode: () => void;
  /** Re-read the active vault's settings (after a vault switch). */
  reload: () => Promise<void>;
}

export const AppearanceContext = createContext<AppearanceContextValue | null>(
  null,
);

export function useAppearance(): AppearanceContextValue {
  const ctx = useContext(AppearanceContext);
  if (!ctx) throw new Error("useAppearance must be used inside ThemeProvider");
  return ctx;
}
