/**
 * Theme registry. Keep in sync with `styles/tokens.css` — adding a theme
 * here without a matching `.theme-<name>` block is a runtime no-op.
 */

export type ThemeName = "paper" | "navy" | "forest" | "sepia";

export const THEMES: ThemeName[] = ["paper", "navy", "forest", "sepia"];

export interface ThemeMeta {
  name: ThemeName;
  label: string;
  description: string;
  /** A preview of the cardinal colors for the swatch chip in pickers. */
  swatch: {
    bgBase: string;
    bgSurface: string;
    ink: string;
    agent: string;
    you: string;
    node: string;
  };
}

/**
 * Static swatches mirror the hex values shipped in `tokens.css`. Keeping
 * them inline (rather than reading via getComputedStyle) lets us render
 * all four cards at once on the theme picker without having to instantiate
 * each theme.
 */
export const THEME_META: Record<ThemeName, ThemeMeta> = {
  paper: {
    name: "paper",
    label: "Paper",
    description: "Warm cream — Loom's default.",
    swatch: {
      bgBase: "#f5f1e8",
      bgSurface: "#ede8da",
      ink: "#1a1815",
      agent: "#2d4a7c",
      you: "#a83a2c",
      node: "#4a6b3a",
    },
  },
  navy: {
    name: "navy",
    label: "Navy",
    description: "Dark mode, blue-leaning.",
    swatch: {
      bgBase: "#0c1322",
      bgSurface: "#131c2f",
      ink: "#e6e3d8",
      agent: "#7da7e8",
      you: "#e8896a",
      node: "#8ab877",
    },
  },
  forest: {
    name: "forest",
    label: "Forest",
    description: "Warm light, moss-toned ink.",
    swatch: {
      bgBase: "#f1ede0",
      bgSurface: "#e6e2d2",
      ink: "#1c2418",
      agent: "#356040",
      you: "#b04a1f",
      node: "#6b8a3a",
    },
  },
  sepia: {
    name: "sepia",
    label: "Sepia",
    description: "Warm light, ochre-shifted.",
    swatch: {
      bgBase: "#f1e8d8",
      bgSurface: "#e8ddc8",
      ink: "#1f1813",
      agent: "#4a3a7c",
      you: "#a8521c",
      node: "#6b6028",
    },
  },
};

export function isThemeName(value: unknown): value is ThemeName {
  return (
    typeof value === "string" && THEMES.includes(value as ThemeName)
  );
}
