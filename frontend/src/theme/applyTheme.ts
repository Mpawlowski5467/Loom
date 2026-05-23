import { THEMES, THEME_META, type ThemeName, isThemeName } from "./themes";

const THEME_CLASS_PREFIX = "theme-";
const MODE_ATTR = "data-theme-mode";
const LS_KEY = "loom.theme";

/**
 * Toggle the active theme by swapping ``theme-*`` classes on ``<html>``.
 * Also sets ``data-theme-mode`` to "light" or "dark" so dark-only CSS
 * (paper grain off, deeper shadows) can key off a single selector.
 * No-op on SSR; writes to localStorage so the next paint can start in
 * the right theme before the API responds.
 */
export function applyTheme(theme: ThemeName): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const name of THEMES) {
    root.classList.toggle(`${THEME_CLASS_PREFIX}${name}`, name === theme);
  }
  root.setAttribute(MODE_ATTR, THEME_META[theme].mode);
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
