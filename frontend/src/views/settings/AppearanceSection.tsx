import { useState } from "react";
import type { ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { ThemePickerGrid } from "../../onboarding/steps/ThemePicker";
import { useApp } from "../../context/app-ctx";
import type { ThemeName } from "../../theme/themes";
import {
  APPEARANCE_DEFAULTS,
  FONT_PRESET_OPTIONS,
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
  // Follow-OS theme tracking is owned by useLoomConfig (app-wide), so it stays
  // active no matter which view is open — this panel only drives the toggle.
  const { theme, setTheme, followOsTheme, setFollowOsTheme } = useApp();
  const [savingTheme, setSavingTheme] = useState<ThemeName | null>(null);
  const [appearance, setAppearanceState] = useState(readInitialAppearance);

  const saveTheme = (next: ThemeName) => {
    // setTheme clears follow-OS automatically (a manual pick is an override).
    setSavingTheme(next);
    void setTheme(next).finally(() => setSavingTheme(null));
  };

  const toggleFollowOs = () => {
    setFollowOsTheme(!followOsTheme);
  };
  const followOs = followOsTheme;

  const update = (patch: Partial<typeof appearance>) => {
    const next = { ...appearance, ...patch };
    setAppearanceState(next);
    applyAppearance(next);
  };

  const isDefaultAppearance =
    appearance.fontPreset === APPEARANCE_DEFAULTS.fontPreset &&
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
          title="Restore typography, density, and motion to defaults"
        >
          <RotateCcw size={13} aria-hidden="true" />
          Reset to defaults
        </button>
      </div>
      <p className="settings-copy">
        These are local preferences — they apply on this device only and survive
        reloads.
      </p>

      <fieldset className="settings-font-presets">
        <legend className="settings-field-label">Font style</legend>
        <div className="settings-font-preset-grid">
          {FONT_PRESET_OPTIONS.map((option) => {
            const active = appearance.fontPreset === option.value;
            return (
              <button
                key={option.value}
                type="button"
                className={`settings-font-preset ${active ? "active" : ""}`}
                onClick={() => update({ fontPreset: option.value })}
                aria-pressed={active}
              >
                <span
                  className="settings-font-preset-sample"
                  style={{ fontFamily: option.previewFont }}
                  aria-hidden="true"
                >
                  Aa
                </span>
                <span className="settings-font-preset-copy">
                  <span className="settings-font-preset-name">
                    {option.label}
                  </span>
                  <span className="settings-font-preset-pairing">
                    {option.pairing}
                  </span>
                  <span className="settings-font-preset-description">
                    {option.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

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
