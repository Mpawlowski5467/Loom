import type { ReactNode } from "react";
import { ThemeGrid } from "@/components/theme/ThemeGrid";
import { useAppearance } from "@/theme/appearance-ctx";
import { THEMES } from "@/theme/registry";

interface Props {
  onNext: () => void;
  onBack: () => void;
}

/**
 * Onboarding theme step. Picking a card applies it to the whole app right
 * away (the wizard recolours around it) and it's saved like any other
 * Appearance change.
 */
export function ThemePicker({ onNext, onBack }: Props): ReactNode {
  const { resolvedTheme, setTheme } = useAppearance();
  return (
    <div className="onb-step">
      <h2 className="onb-h2">Pick a look</h2>
      <p className="onb-sub">
        Loom ships with {THEMES.length} themes. You can change this any time
        from Settings.
      </p>
      <ThemeGrid value={resolvedTheme} onChange={setTheme} className="my-4" />
      <div className="onb-actions">
        <button className="btn btn-md" onClick={onBack}>
          ← Back
        </button>
        <button className="btn btn-md btn-active" onClick={onNext}>
          Next →
        </button>
      </div>
    </div>
  );
}
