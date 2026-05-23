export type FontScale = "sm" | "md" | "lg";
export type Density = "compact" | "cozy" | "comfortable";
export type Motion = "auto" | "on" | "off";

export interface Appearance {
  fontScale: FontScale;
  density: Density;
  motion: Motion;
}

export const APPEARANCE_DEFAULTS: Appearance = {
  fontScale: "md",
  density: "cozy",
  motion: "auto",
};

const FONT_SCALES: FontScale[] = ["sm", "md", "lg"];
const DENSITIES: Density[] = ["compact", "cozy", "comfortable"];
const MOTIONS: Motion[] = ["auto", "on", "off"];

const LS_KEY = "loom.appearance";

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
      fontScale: isFontScale(parsed.fontScale)
        ? parsed.fontScale
        : APPEARANCE_DEFAULTS.fontScale,
      density: isDensity(parsed.density)
        ? parsed.density
        : APPEARANCE_DEFAULTS.density,
      motion: isMotion(parsed.motion) ? parsed.motion : APPEARANCE_DEFAULTS.motion,
    };
  } catch {
    return APPEARANCE_DEFAULTS;
  }
}
