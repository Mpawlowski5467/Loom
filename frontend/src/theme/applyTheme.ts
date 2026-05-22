import { THEMES, type ThemeName, isThemeName } from "./themes";

const THEME_CLASS_PREFIX = "theme-";
const LS_KEY = "loom.theme";

/**
 * Toggle the active theme by swapping ``theme-*`` classes on ``<html>``.
 * No-op on SSR; writes to localStorage so the next paint can start in
 * the right theme before the API responds.
 */
export function applyTheme(theme: ThemeName): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const name of THEMES) {
    root.classList.toggle(`${THEME_CLASS_PREFIX}${name}`, name === theme);
  }
  try {
    window.localStorage.setItem(LS_KEY, theme);
  } catch {
    // Quota/storage unavailable — fine, the class stays applied.
  }
}

/**
 * Best-effort theme to paint immediately on boot. Order of preference:
 *   1. ``?theme=<name>`` query string  (QA / debug)
 *   2. ``localStorage[loom.theme]``    (last applied)
 *   3. ``"paper"``                     (default)
 */
export function readInitialTheme(): ThemeName {
  if (typeof window !== "undefined") {
    try {
      const qs = new URLSearchParams(window.location.search).get("theme");
      if (isThemeName(qs)) return qs;
    } catch {
      // Falls through.
    }
    try {
      const stored = window.localStorage.getItem(LS_KEY);
      if (isThemeName(stored)) return stored;
    } catch {
      // Falls through.
    }
  }
  return "paper";
}
