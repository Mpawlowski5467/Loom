import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  readFollowOsTheme,
  writeFollowOsTheme,
  osThemeMode,
  themeForOsMode,
  subscribeOsTheme,
} from "./themeAuto";
import { defaultThemeForMode } from "./themes";

const LS_KEY = "loom.theme.followOs";

/** Install a controllable matchMedia for prefers-color-scheme: dark. */
function stubMatchMedia(dark: boolean) {
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
    /** Fire a preference change to all listeners. */
    flip(toDark: boolean) {
      mql.matches = toDark;
      for (const cb of listeners) cb({ matches: toDark } as MediaQueryListEvent);
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readFollowOsTheme / writeFollowOsTheme", () => {
  it("defaults to false", () => {
    expect(readFollowOsTheme()).toBe(false);
  });

  it("round-trips the flag", () => {
    writeFollowOsTheme(true);
    expect(readFollowOsTheme()).toBe(true);
    expect(window.localStorage.getItem(LS_KEY)).toBe("1");
  });

  it("clears the flag when set false", () => {
    writeFollowOsTheme(true);
    writeFollowOsTheme(false);
    expect(readFollowOsTheme()).toBe(false);
    expect(window.localStorage.getItem(LS_KEY)).toBeNull();
  });
});

describe("osThemeMode", () => {
  it("reports dark when the OS prefers dark", () => {
    stubMatchMedia(true);
    expect(osThemeMode()).toBe("dark");
  });

  it("reports light when the OS prefers light", () => {
    stubMatchMedia(false);
    expect(osThemeMode()).toBe("light");
  });

  it("defaults to light when matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(osThemeMode()).toBe("light");
  });
});

describe("themeForOsMode", () => {
  it("keeps the current theme when it already matches the mode", () => {
    // paper is light → staying in light keeps paper.
    expect(themeForOsMode("light", "paper")).toBe("paper");
  });

  it("falls back to the registry default for the opposite mode", () => {
    // current is light (paper); OS wants dark → default dark theme.
    expect(themeForOsMode("dark", "paper")).toBe(defaultThemeForMode("dark"));
  });

  it("keeps a non-default dark theme when the mode matches", () => {
    const darkDefault = defaultThemeForMode("dark");
    expect(themeForOsMode("dark", darkDefault)).toBe(darkDefault);
  });
});

describe("subscribeOsTheme", () => {
  it("invokes the callback with the new mode on preference change", () => {
    const media = stubMatchMedia(false);
    const onChange = vi.fn();
    const unsub = subscribeOsTheme(onChange);

    media.flip(true);
    expect(onChange).toHaveBeenCalledWith("dark");
    media.flip(false);
    expect(onChange).toHaveBeenCalledWith("light");

    unsub();
    expect(media.listenerCount).toBe(0);
  });

  it("returns a noop when matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);
    const unsub = subscribeOsTheme(vi.fn());
    expect(() => unsub()).not.toThrow();
  });
});
