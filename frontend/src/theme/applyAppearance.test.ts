import { describe, it, expect, beforeEach } from "vitest";
import {
  applyAppearance,
  readInitialAppearance,
  APPEARANCE_DEFAULTS,
  type Appearance,
} from "./applyAppearance";

const LS_KEY = "loom.appearance";

function classes(): string[] {
  return Array.from(document.documentElement.classList);
}

beforeEach(() => {
  document.documentElement.className = "";
  window.localStorage.clear();
});

describe("applyAppearance", () => {
  it("sets exactly one class per axis", () => {
    applyAppearance({ fontScale: "lg", density: "compact", motion: "off" });
    expect(classes()).toContain("font-scale-lg");
    expect(classes()).toContain("density-compact");
    expect(classes()).toContain("motion-off");
    // Only one font-scale class is present.
    expect(classes().filter((c) => c.startsWith("font-scale-"))).toHaveLength(1);
  });

  it("replaces the previous class when an axis changes", () => {
    applyAppearance({ fontScale: "sm", density: "cozy", motion: "auto" });
    applyAppearance({ fontScale: "lg", density: "cozy", motion: "auto" });
    expect(classes()).toContain("font-scale-lg");
    expect(classes()).not.toContain("font-scale-sm");
  });

  it("applies the motion-on class so 'Always on' has a CSS hook", () => {
    // Regression: motion-on previously had no class consumer/CSS, making the
    // "Always on" option inert under OS reduce-motion.
    applyAppearance({ fontScale: "md", density: "cozy", motion: "on" });
    expect(classes()).toContain("motion-on");
    expect(classes()).not.toContain("motion-off");
    expect(classes()).not.toContain("motion-auto");
  });

  it("persists the appearance to localStorage", () => {
    const a: Appearance = { fontScale: "sm", density: "comfortable", motion: "on" };
    applyAppearance(a);
    expect(JSON.parse(window.localStorage.getItem(LS_KEY)!)).toEqual(a);
  });
});

describe("readInitialAppearance", () => {
  it("returns defaults when nothing is stored", () => {
    expect(readInitialAppearance()).toEqual(APPEARANCE_DEFAULTS);
  });

  it("round-trips a persisted appearance", () => {
    const a: Appearance = { fontScale: "lg", density: "compact", motion: "off" };
    window.localStorage.setItem(LS_KEY, JSON.stringify(a));
    expect(readInitialAppearance()).toEqual(a);
  });

  it("falls back per-field for invalid stored values", () => {
    window.localStorage.setItem(
      LS_KEY,
      JSON.stringify({ fontScale: "huge", density: "compact", motion: 42 }),
    );
    expect(readInitialAppearance()).toEqual({
      fontScale: APPEARANCE_DEFAULTS.fontScale, // invalid → default
      density: "compact", // valid → kept
      motion: APPEARANCE_DEFAULTS.motion, // invalid → default
    });
  });

  it("returns defaults for unparseable JSON", () => {
    window.localStorage.setItem(LS_KEY, "{not json");
    expect(readInitialAppearance()).toEqual(APPEARANCE_DEFAULTS);
  });
});
