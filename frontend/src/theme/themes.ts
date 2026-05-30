/**
 * Theme registry. Keep in sync with `styles/tokens.css` — adding a theme
 * here without a matching `.theme-<name>` block is a runtime no-op.
 */

export type ThemeName =
  | "paper"
  | "slate"
  | "foundry"
  | "dune"
  | "carbon"
  | "lagoon"
  | "obsidian"
  | "ember"
  | "mulberry";

export const THEMES: ThemeName[] = [
  "paper",
  "slate",
  "foundry",
  "dune",
  "carbon",
  "lagoon",
  "obsidian",
  "ember",
  "mulberry",
];

export type ThemeMode = "light" | "dark";

export interface ThemeMeta {
  name: ThemeName;
  label: string;
  description: string;
  /**
   * "dark" themes get ``data-theme-mode="dark"`` on <html> so any
   * dark-only CSS (paper grain off, deeper shadows) kicks in.
   */
  mode: ThemeMode;
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
  slate: {
    name: "slate",
    label: "Slate",
    description: "Cool stone — royal blue + persimmon.",
    mode: "light",
    swatch: {
      bgBase: "#ecece6",
      bgSurface: "#e0e0d9",
      ink: "#1a1d20",
      agent: "#1e3a8a",
      you: "#c2410c",
      node: "#15803d",
    },
  },
  foundry: {
    name: "foundry",
    label: "Foundry",
    description: "Warm archival cream — ink-blue + brick.",
    mode: "light",
    swatch: {
      bgBase: "#f4efe3",
      bgSurface: "#ebe3d0",
      ink: "#211c15",
      agent: "#2f4a78",
      you: "#b0432e",
      node: "#4f6b35",
    },
  },
  dune: {
    name: "dune",
    label: "Dune",
    description: "Sandy khaki — deep teal + rust.",
    mode: "light",
    swatch: {
      bgBase: "#ece4d0",
      bgSurface: "#dcd1b4",
      ink: "#2a2618",
      agent: "#2b5654",
      you: "#a8521f",
      node: "#6f7b30",
    },
  },
  carbon: {
    name: "carbon",
    label: "Carbon",
    description: "True black — terminal green + magenta.",
    mode: "dark",
    swatch: {
      bgBase: "#0a0a0a",
      bgSurface: "#161616",
      ink: "#ededed",
      agent: "#7eed90",
      you: "#f06c9b",
      node: "#9becff",
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
  obsidian: {
    name: "obsidian",
    label: "Obsidian",
    description: "Near-black — sky + neon orange.",
    mode: "dark",
    swatch: {
      bgBase: "#0a0a0c",
      bgSurface: "#141418",
      ink: "#f0f0ee",
      agent: "#5fb8ff",
      you: "#ff8a3a",
      node: "#5fb8ff",
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
  mulberry: {
    name: "mulberry",
    label: "Mulberry",
    description: "Eggplant — lavender + rose.",
    mode: "dark",
    swatch: {
      bgBase: "#1a1222",
      bgSurface: "#261934",
      ink: "#f0e6f5",
      agent: "#b89dff",
      you: "#ff8da8",
      node: "#74e8c0",
    },
  },
};

export function isThemeName(value: unknown): value is ThemeName {
  return (
    typeof value === "string" && THEMES.includes(value as ThemeName)
  );
}
