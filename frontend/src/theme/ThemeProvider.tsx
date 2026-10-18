import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  appearanceEndpointUnsupported,
  getAppearance,
  putAppearance,
} from "@/api/appearance";
import {
  appearanceAttributes,
  appearanceEquals,
  applyAppearanceAttributes,
  resolveTheme,
  type AppearanceSettings,
} from "./appearance";
import {
  AppearanceContext,
  type AppearanceContextValue,
} from "./appearance-ctx";
import {
  browserStorage,
  readQueryTheme,
  readStoredAppearance,
  writeStoredAppearance,
} from "./appearanceStorage";
import { themeMode, type ThemeId } from "./registry";
import { subscribeSystemTheme, systemPrefersDark } from "./systemTheme";

/** Debounce so dragging through options doesn't PUT on every step. */
const SAVE_DELAY_MS = 300;

/** Paint <html> right away so anything reading computed colors (Sigma via
 *  useThemeColors) sees the new theme in the same render pass. */
function paint(settings: AppearanceSettings, prefersDark: boolean): void {
  applyAppearanceAttributes(
    document.documentElement,
    appearanceAttributes(settings, prefersDark),
  );
}

function initialSettings(): { settings: AppearanceSettings; pinned: boolean } {
  const storage = browserStorage();
  const stored = readStoredAppearance(storage);
  if (stored.migrated) writeStoredAppearance(storage, stored.settings);
  const forced =
    typeof window === "undefined"
      ? null
      : readQueryTheme(window.location.search);
  if (!forced) return { settings: stored.settings, pinned: false };
  return {
    settings: { ...stored.settings, theme: forced, followSystem: false },
    pinned: true,
  };
}

/**
 * Owns appearance: paints `data-*` attributes on <html>, caches settings in
 * localStorage (read by the boot script in index.html), and syncs with the
 * vault through `/api/settings/appearance` when the backend supports it.
 * The vault wins on load; local edits save to both.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [boot] = useState(initialSettings);
  const [settings, setSettings] = useState(boot.settings);
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark);
  const [savedTo, setSavedTo] = useState<"vault" | "device">("device");
  // Latest values for callbacks; written in effects and in commit(), never
  // during render.
  const settingsRef = useRef(settings);
  const prefersDarkRef = useRef(prefersDark);
  // While `?theme=` forces a theme, don't let the vault's copy repaint it.
  const pinnedRef = useRef(boot.pinned);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () =>
      subscribeSystemTheme((dark) => {
        prefersDarkRef.current = dark;
        paint(settingsRef.current, dark);
        setPrefersDark(dark);
      }),
    [],
  );

  // Initial paint, and a safety net for any state change painted elsewhere.
  useLayoutEffect(() => {
    settingsRef.current = settings;
    prefersDarkRef.current = prefersDark;
    paint(settings, prefersDark);
  }, [settings, prefersDark]);

  const saveToVault = useCallback((next: AppearanceSettings) => {
    putAppearance(next)
      .then((ok) => setSavedTo(ok ? "vault" : "device"))
      .catch(() => setSavedTo("device"));
  }, []);

  const commit = useCallback(
    (next: AppearanceSettings) => {
      pinnedRef.current = false;
      settingsRef.current = next;
      paint(next, prefersDarkRef.current);
      setSettings(next);
      writeStoredAppearance(browserStorage(), next);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => saveToVault(next), SAVE_DELAY_MS);
    },
    [saveToVault],
  );

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  /** Adopt the vault's saved settings (the vault wins over the cache). */
  const adoptRemote = useCallback(
    (remote: AppearanceSettings | null) => {
      if (appearanceEndpointUnsupported()) {
        setSavedTo("device");
        return;
      }
      setSavedTo("vault");
      if (!remote) {
        // A vault with nothing saved yet adopts this device's settings.
        saveToVault(settingsRef.current);
        return;
      }
      if (pinnedRef.current || appearanceEquals(remote, settingsRef.current))
        return;
      settingsRef.current = remote;
      paint(remote, prefersDarkRef.current);
      setSettings(remote);
      writeStoredAppearance(browserStorage(), remote);
    },
    [saveToVault],
  );

  // Offline or erroring: keep the cached settings.
  const keepLocal = useCallback(() => setSavedTo("device"), []);

  const reload = useCallback(
    () => getAppearance().then(adoptRemote, keepLocal),
    [adoptRemote, keepLocal],
  );

  useEffect(() => {
    let active = true;
    getAppearance().then(
      (remote) => active && adoptRemote(remote),
      () => active && keepLocal(),
    );
    return () => {
      active = false;
    };
  }, [adoptRemote, keepLocal]);

  const update = useCallback(
    (patch: Partial<AppearanceSettings>) =>
      commit({ ...settingsRef.current, ...patch }),
    [commit],
  );

  const setTheme = useCallback(
    (id: ThemeId) => {
      const slot = themeMode(id) === "dark" ? "darkTheme" : "lightTheme";
      commit({
        ...settingsRef.current,
        theme: id,
        followSystem: false,
        [slot]: id,
      });
    },
    [commit],
  );

  const resolvedTheme = resolveTheme(settings, prefersDark);
  const mode = themeMode(resolvedTheme);

  const toggleMode = useCallback(() => {
    const s = settingsRef.current;
    setTheme(mode === "dark" ? s.lightTheme : s.darkTheme);
  }, [mode, setTheme]);

  const value = useMemo<AppearanceContextValue>(
    () => ({
      settings,
      resolvedTheme,
      mode,
      savedTo,
      update,
      setTheme,
      toggleMode,
      reload,
    }),
    [
      settings,
      resolvedTheme,
      mode,
      savedTo,
      update,
      setTheme,
      toggleMode,
      reload,
    ],
  );

  return (
    <AppearanceContext.Provider value={value}>
      {children}
    </AppearanceContext.Provider>
  );
}
