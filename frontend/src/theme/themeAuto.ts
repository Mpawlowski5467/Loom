import {
  THEME_META,
  defaultThemeForMode,
  type ThemeMode,
  type ThemeName,
} from "./themes";

const LS_KEY = "loom.theme.followOs";

/** Whether the user has opted into following the OS light/dark preference. */
export function readFollowOsTheme(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(LS_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeFollowOsTheme(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (on) window.localStorage.setItem(LS_KEY, "1");
    else window.localStorage.removeItem(LS_KEY);
  } catch {
    // ignore storage failures — the in-memory state still drives this session.
  }
}

/** The OS-preferred mode, defaulting to light when matchMedia is unavailable. */
export function osThemeMode(): ThemeMode {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/**
 * The theme to use for a given OS mode: keep the current theme if it already
 * matches that mode (so a user's light pick is remembered), otherwise fall back
 * to the registry default for that mode.
 */
export function themeForOsMode(mode: ThemeMode, current: ThemeName): ThemeName {
  return THEME_META[current].mode === mode
    ? current
    : defaultThemeForMode(mode);
}

/**
 * Subscribe to OS light/dark changes. Calls ``onChange`` with the resolved
 * theme whenever the preference flips. Returns an unsubscribe function. No-op
 * (returns a noop cleanup) when matchMedia is unavailable.
 */
export function subscribeOsTheme(
  onChange: (mode: ThemeMode) => void,
): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = (e: MediaQueryListEvent) =>
    onChange(e.matches ? "dark" : "light");
  mql.addEventListener("change", handler);
  return () => mql.removeEventListener("change", handler);
}
