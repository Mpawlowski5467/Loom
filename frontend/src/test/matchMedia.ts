import { vi } from "vitest";

/**
 * Stub `window.matchMedia` for `(prefers-color-scheme: dark)`. jsdom has no
 * matchMedia; call `flip()` to simulate the OS switching modes.
 */
export function stubPrefersDark(dark: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const mql = {
    matches: dark,
    media: "(prefers-color-scheme: dark)",
    addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) =>
      listeners.add(cb),
    removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) =>
      listeners.delete(cb),
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => mql),
  );
  return {
    flip(toDark: boolean) {
      mql.matches = toDark;
      for (const cb of listeners)
        cb({ matches: toDark } as MediaQueryListEvent);
    },
  };
}
