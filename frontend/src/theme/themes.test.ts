import { describe, it, expect } from "vitest";
import {
  THEMES,
  THEME_META,
  themesByMode,
  defaultThemeForMode,
  isThemeName,
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
