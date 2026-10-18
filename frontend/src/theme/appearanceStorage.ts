import { normalizeAppearance, type AppearanceSettings } from "./appearance";
import { isThemeId, type ThemeId } from "./registry";

/** Local cache of the appearance settings (mirrored in index.html). */
export const APPEARANCE_STORAGE_KEY = "loom.appearance.v2";

/** Keys written by the pre-shadcn theme system, migrated on first run. */
const LEGACY_THEME_KEY = "loom.theme";
const LEGACY_FOLLOW_OS_KEY = "loom.theme.followOs";
const LEGACY_APPEARANCE_KEY = "loom.appearance";

/**
 * Closest new theme for every name the old theme system ever stored,
 * including names it had itself retired (slate, foundry, …).
 */
export const LEGACY_THEME_MAP: Readonly<Record<string, ThemeId>> = {
  paper: "linen",
  porcelain: "paper",
  herbarium: "linen",
  midnight: "midnight",
  lagoon: "forest",
  ember: "graphite",
  slate: "paper",
  foundry: "linen",
  dune: "linen",
  carbon: "midnight",
  obsidian: "midnight",
  nocturne: "midnight",
  mulberry: "graphite",
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** localStorage, or null where it's unavailable (privacy mode, SSR). */
export function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Font presets that leaned on a serif face map to the serif editor font. */
const SERIF_PRESETS = new Set(["editorial", "literary"]);

function readLegacy(storage: StorageLike): AppearanceSettings | null {
  const theme = storage.getItem(LEGACY_THEME_KEY);
  const followOs = storage.getItem(LEGACY_FOLLOW_OS_KEY);
  const old = parseJson(storage.getItem(LEGACY_APPEARANCE_KEY)) as Record<
    string,
    unknown
  > | null;
  if (theme === null && followOs === null && old === null) return null;
  return normalizeAppearance({
    theme: theme ? LEGACY_THEME_MAP[theme] : undefined,
    followSystem: followOs === "1",
    editorFont:
      old && typeof old.fontPreset === "string"
        ? SERIF_PRESETS.has(old.fontPreset)
          ? "serif"
          : "geist"
        : undefined,
    textSize: old?.fontScale,
    density: old?.density,
    motion: old?.motion,
  });
}

export interface StoredAppearance {
  settings: AppearanceSettings;
  /** True when the settings came from the old keys and need writing back. */
  migrated: boolean;
}

export function readStoredAppearance(
  storage: StorageLike | null,
): StoredAppearance {
  if (!storage) return { settings: normalizeAppearance(null), migrated: false };
  try {
    const current = parseJson(storage.getItem(APPEARANCE_STORAGE_KEY));
    if (current)
      return { settings: normalizeAppearance(current), migrated: false };
    const legacy = readLegacy(storage);
    if (legacy) return { settings: legacy, migrated: true };
  } catch {
    // Storage threw on read: fall through to defaults.
  }
  return { settings: normalizeAppearance(null), migrated: false };
}

export function writeStoredAppearance(
  storage: StorageLike | null,
  settings: AppearanceSettings,
): void {
  if (!storage) return;
  try {
    storage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(settings));
    storage.removeItem(LEGACY_THEME_KEY);
    storage.removeItem(LEGACY_FOLLOW_OS_KEY);
    storage.removeItem(LEGACY_APPEARANCE_KEY);
  } catch {
    // Quota or privacy mode: the in-memory state still drives this session.
  }
}

/** `?theme=<id>` forces a theme for one page load (QA, screenshots). */
export function readQueryTheme(search: string): ThemeId | null {
  try {
    const value = new URLSearchParams(search).get("theme");
    if (isThemeId(value)) return value;
    return value ? (LEGACY_THEME_MAP[value] ?? null) : null;
  } catch {
    return null;
  }
}
