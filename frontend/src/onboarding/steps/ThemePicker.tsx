import type { ReactNode } from "react";
import { ThemeGrid } from "@/components/theme/ThemeGrid";
import { Button } from "@/components/ui/button";
import { useAppearance } from "@/theme/appearance-ctx";
import { THEMES } from "@/theme/registry";
import { Step, StepActions, StepHeader } from "../StepLayout";

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
    <Step>
      <StepHeader
        title="Pick a look"
        description={
          <>
            Loom ships with {THEMES.length} themes. You can change this any time
            from Settings.
          </>
        }
      />
      <ThemeGrid value={resolvedTheme} onChange={setTheme} />
      <StepActions>
        <Button variant="ghost" onClick={onBack}>
          ← Back
        </Button>
        <Button onClick={onNext}>Next →</Button>
      </StepActions>
    </Step>
  );
}
