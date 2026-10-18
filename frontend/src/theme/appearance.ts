import {
  BRAND_OVERRIDES,
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  DEFAULT_THEME,
  isThemeId,
  themeMode,
  type BrandOverride,
  type EditorFont,
  type GraphPalette,
  type ThemeId,
  type ThemeMode,
} from "./registry";

/**
 * Appearance settings: the shape persisted to `config/appearance.yaml` (via
 * `/api/settings/appearance`) and cached in localStorage. `index.html` holds
 * a hand-written copy of {@link appearanceAttributes} that paints <html>
 * before the bundle loads; `boot.test.ts` keeps the two in sync.
 */

export type TextSize = "sm" | "md" | "lg";
export type Density = "compact" | "cozy" | "comfortable";
export type Motion = "auto" | "on" | "off";

export interface AppearanceSettings {
  theme: ThemeId;
  followSystem: boolean;
  /** Theme used for an OS dark preference while following the system. */
  darkTheme: ThemeId;
  /** Theme used for an OS light preference while following the system. */
  lightTheme: ThemeId;
  /** One of the five accent hexes, or null for the theme's own accent. */
  brandOverride: string | null;
  editorFont: EditorFont;
  graphPalette: GraphPalette;
  textSize: TextSize;
  density: Density;
  motion: Motion;
}

export const APPEARANCE_DEFAULTS: AppearanceSettings = {
  theme: DEFAULT_THEME,
  followSystem: false,
  darkTheme: DEFAULT_DARK_THEME,
  lightTheme: DEFAULT_LIGHT_THEME,
  brandOverride: null,
  editorFont: "geist",
  graphPalette: "theme",
  textSize: "md",
  density: "cozy",
  motion: "auto",
};

/** The accent swatches the spec offers, keyed by the hex that's persisted. */
export const BRAND_HEX: Readonly<Record<BrandOverride, string>> = {
  blue: "#3b82f6",
  teal: "#14b8a6",
  amber: "#f59e0b",
  violet: "#8b5cf6",
  rose: "#f43f5e",
};

export function brandIdForHex(hex: string | null): BrandOverride | null {
  if (!hex) return null;
  const match = BRAND_OVERRIDES.find(
    (b) => BRAND_HEX[b.id] === hex.toLowerCase(),
  );
  return match?.id ?? null;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function themeForSlot(
  value: unknown,
  mode: ThemeMode,
  theme: ThemeId,
  fallback: ThemeId,
): ThemeId {
  if (isThemeId(value) && themeMode(value) === mode) return value;
  return themeMode(theme) === mode ? theme : fallback;
}

/** Coerce anything (storage, API, mocks) into valid settings. */
export function normalizeAppearance(raw: unknown): AppearanceSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const theme = isThemeId(r.theme) ? r.theme : APPEARANCE_DEFAULTS.theme;
  const brand =
    typeof r.brandOverride === "string" ? brandIdForHex(r.brandOverride) : null;
  return {
    theme,
    followSystem: r.followSystem === true,
    darkTheme: themeForSlot(r.darkTheme, "dark", theme, DEFAULT_DARK_THEME),
    lightTheme: themeForSlot(r.lightTheme, "light", theme, DEFAULT_LIGHT_THEME),
    brandOverride: brand ? BRAND_HEX[brand] : null,
    editorFont: oneOf(r.editorFont, ["geist", "mono", "serif"], "geist"),
    graphPalette: oneOf(r.graphPalette, ["theme", "colorblind"], "theme"),
    textSize: oneOf(r.textSize, ["sm", "md", "lg"], "md"),
    density: oneOf(r.density, ["compact", "cozy", "comfortable"], "cozy"),
    motion: oneOf(r.motion, ["auto", "on", "off"], "auto"),
  };
}

export function appearanceEquals(
  a: AppearanceSettings,
  b: AppearanceSettings,
): boolean {
  return (Object.keys(a) as (keyof AppearanceSettings)[]).every(
    (k) => a[k] === b[k],
  );
}

/** The theme actually on screen, given the OS preference. */
export function resolveTheme(
  s: AppearanceSettings,
  prefersDark: boolean,
): ThemeId {
  if (!s.followSystem) return s.theme;
  return prefersDark ? s.darkTheme : s.lightTheme;
}

/** Attribute values for <html>; `null` means remove the attribute. */
export function appearanceAttributes(
  s: AppearanceSettings,
  prefersDark: boolean,
): Record<string, string | null> {
  const theme = resolveTheme(s, prefersDark);
  return {
    "data-theme": theme,
    "data-theme-mode": themeMode(theme),
    "data-brand": brandIdForHex(s.brandOverride),
    "data-graph-palette": s.graphPalette === "colorblind" ? "colorblind" : null,
    "data-editor-font": s.editorFont,
    "data-text-size": s.textSize,
    "data-density": s.density,
    "data-motion": s.motion,
  };
}

export function applyAppearanceAttributes(
  root: HTMLElement,
  attrs: Record<string, string | null>,
): void {
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null) root.removeAttribute(name);
    else root.setAttribute(name, value);
  }
}
