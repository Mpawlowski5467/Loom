import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubPrefersDark } from "@/test/matchMedia";
import { appearanceAttributes } from "./appearance";
import { readQueryTheme, readStoredAppearance } from "./appearanceStorage";

/*
 * index.html carries a hand-written boot script that paints <html> before
 * the bundle loads. This runs that exact script against the TypeScript
 * implementation for a range of stored states and asserts identical output,
 * so the two can't drift apart.
 */

const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
const bootScript = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];

const ATTRS = [
  "data-theme",
  "data-theme-mode",
  "data-brand",
  "data-graph-palette",
  "data-editor-font",
  "data-text-size",
  "data-density",
  "data-motion",
];

interface Scenario {
  name: string;
  storage?: Record<string, string>;
  search?: string;
  prefersDark?: boolean;
}

const SCENARIOS: Scenario[] = [
  { name: "nothing stored" },
  {
    name: "every option customised",
    storage: {
      "loom.appearance.v2": JSON.stringify({
        theme: "midnight",
        brandOverride: "#14B8A6",
        graphPalette: "colorblind",
        editorFont: "serif",
        textSize: "lg",
        density: "compact",
        motion: "off",
      }),
    },
  },
  {
    name: "follow system, OS dark",
    storage: {
      "loom.appearance.v2": JSON.stringify({
        theme: "paper",
        followSystem: true,
        darkTheme: "forest",
        lightTheme: "linen",
      }),
    },
    prefersDark: true,
  },
  {
    name: "follow system, OS light, slots invalid",
    storage: {
      "loom.appearance.v2": JSON.stringify({
        theme: "linen",
        followSystem: true,
        darkTheme: "paper",
        lightTheme: "nope",
      }),
    },
    prefersDark: false,
  },
  {
    name: "follow system, OS dark, light theme picked",
    storage: {
      "loom.appearance.v2": JSON.stringify({
        theme: "paper",
        followSystem: true,
      }),
    },
    prefersDark: true,
  },
  { name: "unreadable JSON", storage: { "loom.appearance.v2": "{" } },
  {
    name: "JSON that isn't an object",
    storage: { "loom.appearance.v2": '"x"' },
  },
  {
    name: "unknown accent hex",
    storage: { "loom.appearance.v2": '{"brandOverride":"#000000"}' },
  },
  {
    name: "legacy keys",
    storage: {
      "loom.theme": "herbarium",
      "loom.theme.followOs": "1",
      "loom.appearance": JSON.stringify({
        fontPreset: "editorial",
        fontScale: "sm",
        density: "comfortable",
        motion: "on",
      }),
    },
    prefersDark: false,
  },
  { name: "legacy retired theme", storage: { "loom.theme": "mulberry" } },
  {
    name: "legacy modern preset",
    storage: { "loom.appearance": '{"fontPreset":"modern"}' },
  },
  {
    name: "?theme= overrides storage",
    storage: { "loom.appearance.v2": '{"theme":"paper"}' },
    search: "?theme=forest",
  },
  { name: "?theme= with an old name", search: "?theme=lagoon" },
  { name: "?theme= unknown", search: "?theme=nope" },
];

function expected(prefersDark: boolean): Record<string, string | null> {
  let { settings } = readStoredAppearance(localStorage);
  const forced = readQueryTheme(window.location.search);
  if (forced) settings = { ...settings, theme: forced, followSystem: false };
  return appearanceAttributes(settings, prefersDark);
}

function actual(): Record<string, string | null> {
  const root = document.documentElement;
  return Object.fromEntries(ATTRS.map((a) => [a, root.getAttribute(a)]));
}

describe("index.html boot script", () => {
  afterEach(() => {
    localStorage.clear();
    window.history.replaceState(null, "", "/");
    for (const a of ATTRS) document.documentElement.removeAttribute(a);
    vi.unstubAllGlobals();
  });

  it("is present", () => {
    expect(bootScript).toBeTruthy();
  });

  it.each(SCENARIOS)("matches the TypeScript for: $name", (scenario) => {
    for (const [k, v] of Object.entries(scenario.storage ?? {}))
      localStorage.setItem(k, v);
    window.history.replaceState(null, "", `/${scenario.search ?? ""}`);
    stubPrefersDark(scenario.prefersDark ?? false);

    new Function(bootScript!)();

    expect(actual()).toEqual(expected(scenario.prefersDark ?? false));
  });
});
