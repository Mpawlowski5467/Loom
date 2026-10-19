/**
 * Theme registry: the six themes, accent overrides, editor fonts and graph
 * palettes the Appearance settings offer. Colors themselves live only in
 * `src/styles/themes.css`; this module holds ids, labels and modes.
 */

export type ThemeId =
  | "graphite"
  | "paper"
  | "midnight"
  | "forest"
  | "linen"
  | "high-contrast";

export type ThemeMode = "light" | "dark";

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  description: string;
  mode: ThemeMode;
}

export const THEMES: readonly ThemeMeta[] = [
  {
    id: "graphite",
    label: "Graphite",
    description: "Default. Neutral dark with a blue accent.",
    mode: "dark",
  },
  {
    id: "paper",
    label: "Paper",
    description: "Clean light theme for daytime.",
    mode: "light",
  },
  {
    id: "midnight",
    label: "Midnight",
    description: "Deep navy with soft indigo.",
    mode: "dark",
  },
  {
    id: "forest",
    label: "Forest",
    description: "Green-tinted dark, easy on the eyes.",
    mode: "dark",
  },
  {
    id: "linen",
    label: "Linen",
    description: "Warm light theme for long reading.",
    mode: "light",
  },
  {
    id: "high-contrast",
    label: "High contrast",
    description: "Maximum legibility with a yellow focus.",
    mode: "dark",
  },
];

export const DEFAULT_THEME: ThemeId = "graphite";
export const DEFAULT_DARK_THEME: ThemeId = "graphite";
export const DEFAULT_LIGHT_THEME: ThemeId = "paper";

const META_BY_ID = new Map(THEMES.map((t) => [t.id, t]));

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && META_BY_ID.has(value as ThemeId);
}

export function themeMeta(id: ThemeId): ThemeMeta {
  return META_BY_ID.get(id)!;
}

export function themeMode(id: ThemeId): ThemeMode {
  return themeMeta(id).mode;
}

export function themesForMode(mode: ThemeMode): ThemeId[] {
  return THEMES.filter((t) => t.mode === mode).map((t) => t.id);
}

export type BrandOverride = "blue" | "teal" | "amber" | "violet" | "rose";

export const BRAND_OVERRIDES: readonly { id: BrandOverride; label: string }[] =
  [
    { id: "blue", label: "Blue" },
    { id: "teal", label: "Teal" },
    { id: "amber", label: "Amber" },
    { id: "violet", label: "Violet" },
    { id: "rose", label: "Rose" },
  ];

export function isBrandOverride(value: unknown): value is BrandOverride {
  return BRAND_OVERRIDES.some((b) => b.id === value);
}

export type EditorFont = "geist" | "mono" | "serif";

export const EDITOR_FONTS: readonly { id: EditorFont; label: string }[] = [
  { id: "geist", label: "Geist" },
  { id: "mono", label: "Geist Mono" },
  { id: "serif", label: "Newsreader" },
];

export type GraphPalette = "theme" | "colorblind";

export const GRAPH_PALETTES: readonly { id: GraphPalette; label: string }[] = [
  { id: "theme", label: "Follow theme" },
  { id: "colorblind", label: "Colorblind-safe" },
];
