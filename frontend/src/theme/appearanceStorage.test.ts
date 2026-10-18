import { beforeEach, describe, expect, it } from "vitest";
import {
  APPEARANCE_STORAGE_KEY,
  readQueryTheme,
  readStoredAppearance,
  writeStoredAppearance,
} from "./appearanceStorage";
import { normalizeAppearance } from "./appearance";

describe("appearance storage", () => {
  beforeEach(() => localStorage.clear());

  it("reads the current key", () => {
    localStorage.setItem(
      APPEARANCE_STORAGE_KEY,
      JSON.stringify({ theme: "forest", density: "compact" }),
    );
    const { settings, migrated } = readStoredAppearance(localStorage);
    expect(migrated).toBe(false);
    expect(settings.theme).toBe("forest");
    expect(settings.density).toBe("compact");
  });

  it("migrates the old theme, follow-OS and appearance keys", () => {
    localStorage.setItem("loom.theme", "herbarium");
    localStorage.setItem("loom.theme.followOs", "1");
    localStorage.setItem(
      "loom.appearance",
      JSON.stringify({
        fontPreset: "literary",
        fontScale: "lg",
        motion: "off",
      }),
    );
    const { settings, migrated } = readStoredAppearance(localStorage);
    expect(migrated).toBe(true);
    expect(settings).toMatchObject({
      theme: "linen",
      followSystem: true,
      lightTheme: "linen",
      darkTheme: "graphite",
      editorFont: "serif",
      textSize: "lg",
      motion: "off",
    });
  });

  it("maps names the old system had itself retired", () => {
    localStorage.setItem("loom.theme", "mulberry");
    expect(readStoredAppearance(localStorage).settings.theme).toBe("graphite");
  });

  it("writes the new key and clears the old ones", () => {
    localStorage.setItem("loom.theme", "paper");
    writeStoredAppearance(
      localStorage,
      normalizeAppearance({ theme: "paper" }),
    );
    expect(localStorage.getItem("loom.theme")).toBeNull();
    expect(
      JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY)!),
    ).toMatchObject({ theme: "paper" });
  });

  it("falls back to defaults on unreadable JSON", () => {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, "{");
    expect(readStoredAppearance(localStorage).settings.theme).toBe("graphite");
  });

  it("accepts new and old names in ?theme=", () => {
    expect(readQueryTheme("?theme=high-contrast")).toBe("high-contrast");
    expect(readQueryTheme("?theme=lagoon")).toBe("forest");
    expect(readQueryTheme("?theme=nope")).toBeNull();
    expect(readQueryTheme("")).toBeNull();
  });
});
