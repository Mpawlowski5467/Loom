/**
 * Read a CSS custom property off ``<html>``. Falls back to ``fallback``
 * when the var is unset or the document is missing (SSR / unit tests).
 *
 * Use this for any value that needs to follow the active theme but can't be
 * expressed in CSS — primarily the colors Sigma.js reads at paint time.
 */
export function readCssVar(name: string, fallback = "#000"): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}
