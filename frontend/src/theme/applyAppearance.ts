export type FontScale = "sm" | "md" | "lg";
export type FontPreset =
  | "editorial"
  | "source"
  | "modern"
  | "literary"
  | "hyperlegible"
  | "native";
export type Density = "compact" | "cozy" | "comfortable";
export type Motion = "auto" | "on" | "off";

export interface Appearance {
  fontPreset: FontPreset;
  fontScale: FontScale;
  density: Density;
  motion: Motion;
}

export const APPEARANCE_DEFAULTS: Appearance = {
  fontPreset: "editorial",
  fontScale: "md",
  density: "cozy",
  motion: "auto",
};

export interface FontPresetOption {
  value: FontPreset;
  label: string;
  pairing: string;
  description: string;
  previewFont: string;
}

export const FONT_PRESET_OPTIONS: FontPresetOption[] = [
  {
    value: "editorial",
    label: "Loom Editorial",
    pairing: "Fraunces + Inter",
    description: "Expressive headings with a calm, compact interface.",
    previewFont: '"Fraunces Variable", "Iowan Old Style", Georgia, serif',
  },
  {
    value: "source",
    label: "Source Classic",
    pairing: "Source Sans + Serif + Code",
    description:
      "A balanced, highly readable family for long working sessions.",
    previewFont: '"Source Serif 4 Variable", Georgia, serif',
  },
  {
    value: "modern",
    label: "Modern",
    pairing: "Manrope",
    description: "Clean geometry and an even rhythm throughout the app.",
    previewFont: '"Manrope Variable", system-ui, sans-serif',
  },
  {
    value: "literary",
    label: "Literary",
    pairing: "Newsreader + Manrope",
    description: "Bookish titles paired with a contemporary interface.",
    previewFont: '"Newsreader Variable", "Iowan Old Style", Georgia, serif',
  },
  {
    value: "hyperlegible",
    label: "Hyperlegible",
    pairing: "Atkinson Hyperlegible Next",
    description: "Distinct letterforms designed for effortless scanning.",
    previewFont: '"Atkinson Hyperlegible Next Variable", system-ui, sans-serif',
  },
  {
    value: "native",
    label: "System Native",
    pairing: "Your operating system",
    description: "Fast, familiar platform fonts with no custom face.",
    previewFont:
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  },
];

const FONT_PRESETS = FONT_PRESET_OPTIONS.map((option) => option.value);
const FONT_SCALES: FontScale[] = ["sm", "md", "lg"];
const DENSITIES: Density[] = ["compact", "cozy", "comfortable"];
const MOTIONS: Motion[] = ["auto", "on", "off"];

const LS_KEY = "loom.appearance";

function isFontPreset(v: unknown): v is FontPreset {
  return typeof v === "string" && (FONT_PRESETS as string[]).includes(v);
}

function isFontScale(v: unknown): v is FontScale {
  return typeof v === "string" && (FONT_SCALES as string[]).includes(v);
}
function isDensity(v: unknown): v is Density {
  return typeof v === "string" && (DENSITIES as string[]).includes(v);
}
function isMotion(v: unknown): v is Motion {
  return typeof v === "string" && (MOTIONS as string[]).includes(v);
}

/**
 * Toggle font-scale / density / motion classes on ``<html>``. Persists
 * the choice to localStorage so the next reload paints with the right
 * classes before React mounts.
 */
export function applyAppearance(a: Appearance): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  for (const preset of FONT_PRESETS) {
    root.classList.toggle(`font-preset-${preset}`, preset === a.fontPreset);
  }
  for (const s of FONT_SCALES) {
    root.classList.toggle(`font-scale-${s}`, s === a.fontScale);
  }
  for (const d of DENSITIES) {
    root.classList.toggle(`density-${d}`, d === a.density);
  }
  for (const m of MOTIONS) {
    root.classList.toggle(`motion-${m}`, m === a.motion);
  }

  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(a));
  } catch {
    // ignore
  }
}

export function readInitialAppearance(): Appearance {
  if (typeof window === "undefined") return APPEARANCE_DEFAULTS;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return APPEARANCE_DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Appearance>;
    return {
      fontPreset: isFontPreset(parsed.fontPreset)
        ? parsed.fontPreset
        : APPEARANCE_DEFAULTS.fontPreset,
      fontScale: isFontScale(parsed.fontScale)
        ? parsed.fontScale
        : APPEARANCE_DEFAULTS.fontScale,
      density: isDensity(parsed.density)
        ? parsed.density
        : APPEARANCE_DEFAULTS.density,
      motion: isMotion(parsed.motion)
        ? parsed.motion
        : APPEARANCE_DEFAULTS.motion,
    };
  } catch {
    return APPEARANCE_DEFAULTS;
  }
}
