import { describe, it, expect } from "vitest";
import {
  THEMES,
  THEME_META,
  themesByMode,
  defaultThemeForMode,
  isThemeName,
  normalizeThemeName,
} from "./themes";

describe("themesByMode", () => {
  it("returns only light themes in registry order", () => {
    const light = themesByMode("light");
    expect(light.length).toBeGreaterThan(0);
    for (const name of light) expect(THEME_META[name].mode).toBe("light");
  });

  it("returns only dark themes", () => {
    const dark = themesByMode("dark");
    expect(dark.length).toBeGreaterThan(0);
    for (const name of dark) expect(THEME_META[name].mode).toBe("dark");
  });

  it("partitions every theme into exactly one mode group", () => {
    const total = themesByMode("light").length + themesByMode("dark").length;
    expect(total).toBe(THEMES.length);
  });

  it("exposes only the six selected themes", () => {
    expect(themesByMode("light")).toEqual(["paper", "porcelain", "herbarium"]);
    expect(themesByMode("dark")).toEqual(["midnight", "lagoon", "ember"]);
  });

  it("provides complete hex swatches for every registered theme", () => {
    for (const name of THEMES) {
      expect(THEME_META[name].name).toBe(name);
      for (const color of Object.values(THEME_META[name].swatch)) {
        expect(color).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });
});

describe("normalizeThemeName", () => {
  it("keeps final theme names unchanged", () => {
    expect(normalizeThemeName("lagoon")).toBe("lagoon");
  });

  it.each([
    ["slate", "porcelain"],
    ["foundry", "paper"],
    ["dune", "herbarium"],
    ["carbon", "midnight"],
    ["obsidian", "midnight"],
    ["mulberry", "ember"],
    ["nocturne", "midnight"],
  ])("migrates %s to %s", (legacy, expected) => {
    expect(normalizeThemeName(legacy)).toBe(expected);
  });

  it("rejects unknown names", () => {
    expect(normalizeThemeName("neon-rainbow")).toBeNull();
  });
});

describe("defaultThemeForMode", () => {
  it("returns the first registry theme of each mode", () => {
    expect(defaultThemeForMode("light")).toBe(themesByMode("light")[0]);
    expect(defaultThemeForMode("dark")).toBe(themesByMode("dark")[0]);
  });

  it("returns valid theme names", () => {
    expect(isThemeName(defaultThemeForMode("light"))).toBe(true);
    expect(isThemeName(defaultThemeForMode("dark"))).toBe(true);
  });
});
