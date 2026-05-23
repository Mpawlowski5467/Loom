import { useState } from "react";
import type { ReactNode } from "react";
import { ThemePickerGrid } from "../../onboarding/steps/ThemePicker";
import { useApp } from "../../context/app-ctx";
import type { ThemeName } from "../../theme/themes";

export function AppearanceSection(): ReactNode {
  const { theme, setTheme } = useApp();
  const [savingTheme, setSavingTheme] = useState<ThemeName | null>(null);

  const saveTheme = (next: ThemeName) => {
    setSavingTheme(next);
    void setTheme(next).finally(() => setSavingTheme(null));
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
    </div>
  );
}
