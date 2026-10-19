import { describe, expect, it } from "vitest";
import {
  APPEARANCE_DEFAULTS,
  appearanceAttributes,
  brandIdForHex,
  normalizeAppearance,
  resolveTheme,
} from "./appearance";

describe("normalizeAppearance", () => {
  it("returns defaults for anything that isn't settings", () => {
    expect(normalizeAppearance(null)).toEqual(APPEARANCE_DEFAULTS);
    expect(normalizeAppearance("graphite")).toEqual(APPEARANCE_DEFAULTS);
  });

  it("drops invalid fields one by one", () => {
    const s = normalizeAppearance({
      theme: "midnight",
      editorFont: "comic-sans",
      textSize: "xl",
      brandOverride: "#123456",
    });
    expect(s.theme).toBe("midnight");
    expect(s.editorFont).toBe("geist");
    expect(s.textSize).toBe("md");
    expect(s.brandOverride).toBeNull();
  });

  it("keeps each follow-system slot in its own mode", () => {
    const s = normalizeAppearance({
      theme: "linen",
      darkTheme: "paper",
      lightTheme: "forest",
    });
    // Wrong-mode slots fall back: the light slot takes the light theme.
    expect(s.darkTheme).toBe("graphite");
    expect(s.lightTheme).toBe("linen");
  });

  it("canonicalises accent hexes", () => {
    expect(
      normalizeAppearance({ brandOverride: "#14B8A6" }).brandOverride,
    ).toBe("#14b8a6");
    expect(brandIdForHex("#F43F5E")).toBe("rose");
    expect(brandIdForHex(null)).toBeNull();
  });
});

describe("appearance attributes", () => {
  it("resolves follow-system against the OS preference", () => {
    const s = normalizeAppearance({
      followSystem: true,
      darkTheme: "forest",
      lightTheme: "linen",
    });
    expect(resolveTheme(s, true)).toBe("forest");
    expect(resolveTheme(s, false)).toBe("linen");
  });

  it("maps settings onto <html> attributes", () => {
    const attrs = appearanceAttributes(
      normalizeAppearance({
        theme: "paper",
        brandOverride: "#8b5cf6",
        graphPalette: "colorblind",
        editorFont: "serif",
      }),
      true,
    );
    expect(attrs).toMatchObject({
      "data-theme": "paper",
      "data-theme-mode": "light",
      "data-brand": "violet",
      "data-graph-palette": "colorblind",
      "data-editor-font": "serif",
    });
    expect(
      appearanceAttributes(APPEARANCE_DEFAULTS, true)["data-brand"],
    ).toBeNull();
  });
});
