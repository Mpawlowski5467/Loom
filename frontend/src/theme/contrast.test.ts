import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";
import {
  BRAND_OVERRIDES,
  THEMES,
  type BrandOverride,
  type ThemeMeta,
} from "./registry";

/*
 * WCAG AA check over the shipped stylesheet. The test parses themes.css,
 * resolves every custom property the way a browser would for <html> with a
 * given theme (and optional accent override), then measures contrast.
 * Fix a failing token in themes.css; don't lower the bar here.
 */

type Attrs = Record<string, string>;
type Decl = { prop: string; value: string; spec: number; order: number };

// Read from disk: Vitest stubs CSS modules (even ?raw) to empty strings.
// Vitest runs from the frontend root (jsdom's import.meta.url isn't file:).
const themesCss = readFileSync(
  resolve(process.cwd(), "src/styles/themes.css"),
  "utf8",
);
const ROOT = postcss.parse(themesCss);

/** Match the selector forms themes.css uses: `:root`, `html`, `[a]`, `[a="v"]`. */
function selectorSpecificity(selector: string, attrs: Attrs): number | null {
  const m = /^(:root|html)?((?:\[[\w-]+(?:="[^"]*")?\])*)$/.exec(
    selector.trim(),
  );
  if (!m) return null;
  let spec = m[1] === ":root" ? 10 : m[1] === "html" ? 1 : 0;
  for (const part of m[2]!.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
    const [, name, value] = part;
    if (!(name! in attrs)) return null;
    if (value !== undefined && attrs[name!] !== value) return null;
    spec += 10;
  }
  return spec;
}

function resolveTokens(attrs: Attrs): Map<string, string> {
  const decls: Decl[] = [];
  let order = 0;
  ROOT.walkRules((rule) => {
    const specs = rule.selectors
      .map((s) => selectorSpecificity(s, attrs))
      .filter((s): s is number => s !== null);
    if (specs.length === 0) return;
    const spec = Math.max(...specs);
    rule.walkDecls((d) => {
      if (d.prop.startsWith("--"))
        decls.push({ prop: d.prop, value: d.value, spec, order: order++ });
    });
  });
  decls.sort((a, b) => a.spec - b.spec || a.order - b.order);
  const raw = new Map<string, string>();
  for (const d of decls) raw.set(d.prop, d.value);

  const resolve = (value: string, depth = 0): string => {
    if (depth > 10) throw new Error(`var() cycle near ${value}`);
    return value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => {
      const next = raw.get(name);
      if (next === undefined) throw new Error(`undefined token ${name}`);
      return resolve(next, depth + 1);
    });
  };
  const out = new Map<string, string>();
  for (const [prop, value] of raw) out.set(prop, resolve(value));
  return out;
}

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`expected #rrggbb, got ${hex}`);
  const channels = [0, 2, 4].map((i) => parseInt(m[1]!.slice(i, i + 2), 16));
  const [r, g, b] = channels.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

function attrsFor(theme: ThemeMeta, brand?: BrandOverride): Attrs {
  const attrs: Attrs = {
    "data-theme": theme.id,
    "data-theme-mode": theme.mode,
  };
  if (brand) attrs["data-brand"] = brand;
  return attrs;
}

/** Text pairs required by the spec, plus the other text-on-fill tokens. */
const TEXT_PAIRS: [fg: string, bg: string][] = [
  ...["--foreground", "--secondary-foreground", "--muted-foreground"].flatMap(
    (fg) =>
      ["--background", "--sidebar", "--muted", "--popover", "--accent"].map(
        (bg) => [fg, bg] as [string, string],
      ),
  ),
  ["--chip-foreground", "--chip"],
  ["--brand-foreground", "--brand"],
  ["--primary-foreground", "--primary"],
  ["--nav-active-foreground", "--nav-active"],
  ["--banner-foreground", "--banner"],
  ["--ok-foreground", "--ok"],
  ["--warning-foreground", "--warning"],
  ["--danger-foreground", "--background"],
  ["--danger-foreground", "--muted"],
];

describe.each(THEMES)("theme $id", (theme) => {
  const tokens = resolveTokens(attrsFor(theme));

  it.each(TEXT_PAIRS)("%s on %s meets 4.5:1", (fg, bg) => {
    const ratio = contrastRatio(tokens.get(fg)!, tokens.get(bg)!);
    expect(
      ratio,
      `${fg} on ${bg} = ${ratio.toFixed(2)}`,
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("focus ring (--ring) is visible against the page at 3:1", () => {
    const ratio = contrastRatio(
      tokens.get("--ring")!,
      tokens.get("--background")!,
    );
    expect(ratio).toBeGreaterThanOrEqual(3);
  });

  it.each(BRAND_OVERRIDES.map((b) => b.id))(
    "accent override %s keeps brand text and the ring legible",
    (brand) => {
      const t = resolveTokens(attrsFor(theme, brand));
      expect(
        contrastRatio(t.get("--brand-foreground")!, t.get("--brand")!),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(t.get("--ring")!, t.get("--background")!),
      ).toBeGreaterThanOrEqual(3);
    },
  );
});

describe("theme stylesheet", () => {
  it("defines a block for every registered theme", () => {
    for (const theme of THEMES) {
      expect(themesCss).toContain(`[data-theme="${theme.id}"]`);
    }
  });

  it("applies accent overrides and the colorblind palette over any theme", () => {
    const paper = THEMES.find((t) => t.id === "paper")!;
    const teal = resolveTokens(attrsFor(paper, "teal"));
    expect(teal.get("--brand")).toBe("#0f766e");
    expect(teal.get("--ring")).toBe("#0f766e");
    const cb = resolveTokens({
      ...attrsFor(paper),
      "data-graph-palette": "colorblind",
    });
    expect(cb.get("--community-1")).toBe("#56b4e9");
  });
});
