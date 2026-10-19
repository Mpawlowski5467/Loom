import { useSyncExternalStore } from "react";

const DESKTOP = "(min-width: 1024px)";
const WIDE = "(min-width: 1280px)";

function subscribe(query: string, onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(query);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function matches(query: string): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return window.matchMedia(query).matches;
}

const subscribeDesktop = (cb: () => void) => subscribe(DESKTOP, cb);
const subscribeWide = (cb: () => void) => subscribe(WIDE, cb);

/** Whether the viewport is at least Tailwind's `lg` (1024px) wide. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribeDesktop,
    () => matches(DESKTOP),
    () => true,
  );
}

/** Whether the viewport is at least Tailwind's `xl` (1280px) wide. */
export function useIsWide(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => matches(WIDE),
    () => true,
  );
}
