/**
 * Public theme registry. Keep in sync with `backend/core/config.py`.
 *
 * Legacy CSS blocks remain for one migration window, but only these six
 * themes appear in onboarding and Settings.
 */

export type ThemeName =
  | "paper"
  | "porcelain"
  | "herbarium"
  | "midnight"
  | "lagoon"
  | "ember";

export const THEMES: ThemeName[] = [
  "paper",
  "porcelain",
  "herbarium",
  "midnight",
  "lagoon",
  "ember",
];

/** Previously shipped names and their closest final replacement. */
export const LEGACY_THEME_MIGRATIONS: Readonly<Record<string, ThemeName>> = {
  slate: "porcelain",
  foundry: "paper",
  dune: "herbarium",
  carbon: "midnight",
  obsidian: "midnight",
  mulberry: "ember",
  nocturne: "midnight",
};

export type ThemeMode = "light" | "dark";

export interface ThemeMeta {
  name: ThemeName;
  label: string;
  description: string;
  /** Dark themes set `data-theme-mode="dark"` on `<html>`. */
  mode: ThemeMode;
  /** Cardinal colors used by the static theme-picker preview. */
  swatch: {
    bgBase: string;
    bgSurface: string;
    ink: string;
    agent: string;
    you: string;
    node: string;
  };
}

export const THEME_META: Record<ThemeName, ThemeMeta> = {
  paper: {
    name: "paper",
    label: "Paper",
    description: "Warm cream — Loom's default. Ink-blue + brick.",
    mode: "light",
    swatch: {
      bgBase: "#f5f1e8",
      bgSurface: "#ede8da",
      ink: "#1a1815",
      agent: "#2d4a7c",
      you: "#a83a2c",
      node: "#4a6b3a",
    },
  },
  porcelain: {
    name: "porcelain",
    label: "Porcelain",
    description: "Cool gallery paper — cobalt + vermilion.",
    mode: "light",
    swatch: {
      bgBase: "#f3f4f1",
      bgSurface: "#e7e9e4",
      ink: "#171b1f",
      agent: "#295b85",
      you: "#a23f32",
      node: "#315a35",
    },
  },
  herbarium: {
    name: "herbarium",
    label: "Herbarium",
    description: "Naturalist archive — forest + clay.",
    mode: "light",
    swatch: {
      bgBase: "#f1eddf",
      bgSurface: "#e5deca",
      ink: "#211f19",
      agent: "#315d55",
      you: "#923b30",
      node: "#365529",
    },
  },
  midnight: {
    name: "midnight",
    label: "Midnight Ink",
    description: "Navy-black paper — sky + coral.",
    mode: "dark",
    swatch: {
      bgBase: "#0f1722",
      bgSurface: "#172231",
      ink: "#eef2f3",
      agent: "#83b8df",
      you: "#ef897a",
      node: "#76d49b",
    },
  },
  lagoon: {
    name: "lagoon",
    label: "Lagoon",
    description: "Deep petrol — coral + butter.",
    mode: "dark",
    swatch: {
      bgBase: "#0d1f24",
      bgSurface: "#142e36",
      ink: "#e8f0f0",
      agent: "#ff8a7a",
      you: "#f5d56b",
      node: "#7ddcb4",
    },
  },
  ember: {
    name: "ember",
    label: "Ember",
    description: "Warm espresso — amber + magenta.",
    mode: "dark",
    swatch: {
      bgBase: "#1a120e",
      bgSurface: "#271811",
      ink: "#f0e6d8",
      agent: "#f0a83a",
      you: "#e664a4",
      node: "#b3d164",
    },
  },
};

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === "string" && THEMES.includes(value as ThemeName);
}

/** Normalize current and previously shipped theme names. */
export function normalizeThemeName(value: unknown): ThemeName | null {
  if (isThemeName(value)) return value;
  if (typeof value !== "string") return null;
  return LEGACY_THEME_MIGRATIONS[value] ?? null;
}

export function themesByMode(mode: ThemeMode): ThemeName[] {
  return THEMES.filter((name) => THEME_META[name].mode === mode);
}

/** Registry-first defaults: Paper for light and Midnight Ink for dark. */
export function defaultThemeForMode(mode: ThemeMode): ThemeName {
  return themesByMode(mode)[0] ?? "paper";
}
