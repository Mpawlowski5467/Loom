import { afterEach, describe, expect, it } from "vitest";
import { readDemoMode } from "./demoMode";

describe("readDemoMode", () => {
  afterEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("is off by default", () => {
    expect(readDemoMode()).toBe(false);
  });

  it("?demo=1 enables demo mode and persists the preference", () => {
    window.history.replaceState(null, "", "/?demo=1");
    expect(readDemoMode()).toBe(true);
    expect(window.localStorage.getItem("loom.demoMode")).toBe("1");
  });

  it("?demo=0 opts out and clears the persisted preference", () => {
    window.localStorage.setItem("loom.demoMode", "1");
    window.history.replaceState(null, "", "/?demo=0");
    expect(readDemoMode()).toBe(false);
    expect(window.localStorage.getItem("loom.demoMode")).toBeNull();
  });

  it("reads the persisted preference when there is no query param", () => {
    window.localStorage.setItem("loom.demoMode", "1");
    expect(readDemoMode()).toBe(true);
  });
});
