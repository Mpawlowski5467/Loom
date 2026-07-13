import { beforeEach, describe, expect, it } from "vitest";
import { applyTheme, readInitialTheme } from "./applyTheme";

beforeEach(() => {
  document.documentElement.className = "";
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

describe("applyTheme", () => {
  it("removes retired theme classes before applying the selected theme", () => {
    document.documentElement.classList.add("theme-carbon", "font-scale-md");
    applyTheme("midnight");

    expect(document.documentElement).toHaveClass("theme-midnight");
    expect(document.documentElement).not.toHaveClass("theme-carbon");
    expect(document.documentElement).toHaveClass("font-scale-md");
  });
});

describe("readInitialTheme", () => {
  it("migrates a retired stored theme", () => {
    window.localStorage.setItem("loom.theme", "carbon");
    expect(readInitialTheme()).toBe("midnight");
  });

  it("migrates a retired query-string theme", () => {
    window.history.replaceState({}, "", "/?theme=dune");
    expect(readInitialTheme()).toBe("herbarium");
  });
});
