import { useState } from "react";
import type { ReactNode } from "react";
import { ThemePickerGrid } from "../../onboarding/steps/ThemePicker";
import { useApp } from "../../context/app-ctx";
import type { ThemeName } from "../../theme/themes";
import {
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

  const saveTheme = (next: ThemeName) => {
    setSavingTheme(next);
    void setTheme(next).finally(() => setSavingTheme(null));
  };

  const update = (patch: Partial<typeof appearance>) => {
    const next = { ...appearance, ...patch };
    setAppearanceState(next);
    applyAppearance(next);
  };

  return (
    <div className="settings-panel">
      <div className="settings-kicker">Appearance</div>
      <h1 className="settings-title">Theme</h1>
      <p className="settings-copy">
        Choose the visual treatment Loom uses across the app.
      </p>
      <ThemePickerGrid
        selected={theme}
        onChange={saveTheme}
        className="settings-theme-grid"
      />
      <div className="settings-inline-status" role="status">
        {savingTheme ? `Saving ${savingTheme}…` : `Current theme: ${theme}`}
      </div>

      <h2 className="settings-subhead">Typography & spacing</h2>
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
