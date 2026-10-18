const QUERY = "(prefers-color-scheme: dark)";

/** The OS dark-mode preference; false when matchMedia is unavailable. */
export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(QUERY).matches;
}

/** Call `onChange` whenever the OS preference flips. Returns unsubscribe. */
export function subscribeSystemTheme(
  onChange: (prefersDark: boolean) => void,
): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(QUERY);
  const handler = (e: MediaQueryListEvent) => onChange(e.matches);
  mql.addEventListener("change", handler);
  return () => mql.removeEventListener("change", handler);
}
