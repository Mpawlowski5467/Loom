import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { ThemePickerGrid } from "../../onboarding/steps/ThemePicker";
import { useApp } from "../../context/app-ctx";
import type { ThemeName } from "../../theme/themes";
import {
  osThemeMode,
  readFollowOsTheme,
  subscribeOsTheme,
  themeForOsMode,
  writeFollowOsTheme,
} from "../../theme/themeAuto";
import {
  APPEARANCE_DEFAULTS,
  applyAppearance,
  readInitialAppearance,
  type Density,
  type FontScale,
  type Motion,
} from "../../theme/applyAppearance";

const FONT_SCALE_OPTIONS: { value: FontScale; label: string }[] = [
  { value: "sm", label: "Small" },
  { value: "md", label: "Normal" },
  { value: "lg", label: "Large" },
];

const DENSITY_OPTIONS: { value: Density; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "cozy", label: "Cozy" },
  { value: "comfortable", label: "Comfortable" },
];

const MOTION_OPTIONS: { value: Motion; label: string }[] = [
  { value: "auto", label: "Auto (follow OS)" },
  { value: "on", label: "Always on" },
  { value: "off", label: "Reduce motion" },
];

export function AppearanceSection(): ReactNode {
  const { theme, setTheme } = useApp();
  const [savingTheme, setSavingTheme] = useState<ThemeName | null>(null);
  const [appearance, setAppearanceState] = useState(readInitialAppearance);
  const [followOs, setFollowOs] = useState(readFollowOsTheme);

  // While following the OS, apply the matching theme now and on every flip.
  // The picker is disabled in this mode, so the only theme source is the OS.
  useEffect(() => {
    if (!followOs) return;
    const sync = () => {
      const next = themeForOsMode(osThemeMode(), theme);
      if (next !== theme) void setTheme(next);
    };
    sync();
    return subscribeOsTheme(sync);
    // theme is intentionally excluded: re-subscribing on every theme change
    // would tear down the listener mid-flip. sync() reads the latest theme via
    // closure only at mount/toggle, which is the desired "adopt current" point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followOs]);

  const saveTheme = (next: ThemeName) => {
    // A manual theme pick is an override — stop following the OS.
    if (followOs) {
      setFollowOs(false);
      writeFollowOsTheme(false);
    }
    setSavingTheme(next);
    void setTheme(next).finally(() => setSavingTheme(null));
  };

  const toggleFollowOs = () => {
    const next = !followOs;
    setFollowOs(next);
    writeFollowOsTheme(next);
    if (next) {
      // Adopt the OS-appropriate theme immediately (without clearing the flag
      // we just set — so don't route through saveTheme here).
      const t = themeForOsMode(osThemeMode(), theme);
      setSavingTheme(t);
      void setTheme(t).finally(() => setSavingTheme(null));
    }
  };

  const update = (patch: Partial<typeof appearance>) => {
    const next = { ...appearance, ...patch };
    setAppearanceState(next);
    applyAppearance(next);
  };

  const isDefaultAppearance =
    appearance.fontScale === APPEARANCE_DEFAULTS.fontScale &&
    appearance.density === APPEARANCE_DEFAULTS.density &&
    appearance.motion === APPEARANCE_DEFAULTS.motion;

  const resetAppearance = () => {
    setAppearanceState(APPEARANCE_DEFAULTS);
    applyAppearance(APPEARANCE_DEFAULTS);
  };

  return (
    <div className="settings-panel">
      <div className="settings-kicker">Appearance</div>
      <h1 className="settings-title">Theme</h1>
      <p className="settings-copy">
        Choose the visual treatment Loom uses across the app.
      </p>
      <label className="settings-toggle-row">
        <input
          type="checkbox"
          checked={followOs}
          onChange={toggleFollowOs}
          aria-label="Follow OS appearance"
        />
        <span>
          <span className="settings-toggle-label">Follow OS appearance</span>
          <span className="settings-toggle-hint">
            Switch automatically between a light and dark theme to match your
            system setting.
          </span>
        </span>
      </label>
      <div
        className={followOs ? "settings-theme-locked" : undefined}
        aria-disabled={followOs || undefined}
      >
        <ThemePickerGrid
          selected={theme}
          onChange={saveTheme}
          className="settings-theme-grid"
        />
      </div>
      <div className="settings-inline-status" role="status">
        {followOs
          ? `Following OS — ${theme}`
          : savingTheme
            ? `Saving ${savingTheme}…`
            : `Current theme: ${theme}`}
      </div>

      <div className="settings-subhead-row">
        <h2 className="settings-subhead">Typography & spacing</h2>
        <button
          type="button"
          className="btn btn-md"
          onClick={resetAppearance}
          disabled={isDefaultAppearance}
          title="Restore font size, density, and motion to defaults"
        >
          <RotateCcw size={13} aria-hidden="true" />
          Reset to defaults
        </button>
      </div>
      <p className="settings-copy">
        These are local preferences — they apply on this device only and
        survive reloads.
      </p>

      <div className="settings-field">
        <span className="settings-field-label">Font size</span>
        <div className="settings-segmented">
          {FONT_SCALE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`btn btn-md ${
                appearance.fontScale === opt.value ? "btn-active" : ""
              }`}
              onClick={() => update({ fontScale: opt.value })}
              aria-pressed={appearance.fontScale === opt.value}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-field">
        <span className="settings-field-label">UI density</span>
        <div className="settings-segmented">
          {DENSITY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`btn btn-md ${
                appearance.density === opt.value ? "btn-active" : ""
              }`}
              onClick={() => update({ density: opt.value })}
              aria-pressed={appearance.density === opt.value}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-field">
        <span className="settings-field-label">Motion</span>
        <div className="settings-segmented">
          {MOTION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`btn btn-md ${
                appearance.motion === opt.value ? "btn-active" : ""
              }`}
              onClick={() => update({ motion: opt.value })}
              aria-pressed={appearance.motion === opt.value}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
