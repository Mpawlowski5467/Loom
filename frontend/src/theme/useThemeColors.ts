import { useMemo } from "react";
import { useAppearance } from "./appearance-ctx";
import { readCssVar } from "./readCssVar";

export interface ThemeColors {
  /** Changes whenever any color could have changed (theme, accent, palette). */
  key: string;
  background: string;
  foreground: string;
  mutedForeground: string;
  border: string;
  borderStrong: string;
  brand: string;
  community: [string, string, string, string];
}

function readThemeColors(key: string): ThemeColors {
  return {
    key,
    background: readCssVar("--background", "#09090b"),
    foreground: readCssVar("--foreground", "#fafafa"),
    mutedForeground: readCssVar("--muted-foreground", "#a1a1aa"),
    border: readCssVar("--border", "#27272a"),
    borderStrong: readCssVar("--border-strong", "#3f3f46"),
    brand: readCssVar("--brand", "#60a5fa"),
    community: [
      readCssVar("--community-1", "#60a5fa"),
      readCssVar("--community-2", "#f59e0b"),
      readCssVar("--community-3", "#2dd4bf"),
      readCssVar("--community-4", "#a78bfa"),
    ],
  };
}

/**
 * Resolved theme colors for code that can't read CSS variables itself —
 * chiefly Sigma.js. ThemeProvider paints <html> before the state update
 * that changes `key`, so the values read here are always current; pass
 * `key` to effects that must repaint when colors change.
 */
export function useThemeColors(): ThemeColors {
  const { resolvedTheme, settings } = useAppearance();
  const key = `${resolvedTheme}|${settings.brandOverride ?? "theme"}|${settings.graphPalette}`;
  return useMemo(() => readThemeColors(key), [key]);
}
