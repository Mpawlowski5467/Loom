/**
 * Demo data toggle — OFF by default so a fresh visit shows the new-user UI.
 * Enable for screenshots / dev by appending ``?demo=1`` to the URL; the
 * preference is persisted to ``localStorage["loom.demoMode"]`` so it
 * survives reloads until the user opts out with ``?demo=0``.
 */
const DEMO_LS_KEY = "loom.demoMode";

export function readDemoMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const qs = new URLSearchParams(window.location.search).get("demo");
    if (qs === "1") {
      window.localStorage.setItem(DEMO_LS_KEY, "1");
      return true;
    }
    if (qs === "0") {
      window.localStorage.removeItem(DEMO_LS_KEY);
      return false;
    }
    return window.localStorage.getItem(DEMO_LS_KEY) === "1";
  } catch {
    return false;
  }
}
