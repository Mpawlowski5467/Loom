import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAppearance } from "@/theme/appearance-ctx";
import { themeMeta } from "@/theme/registry";

/** Flip between the user's dark and light themes. */
export function ThemeToggle() {
  const { mode, settings, toggleMode } = useAppearance();
  const target = mode === "dark" ? settings.lightTheme : settings.darkTheme;
  const label = `Switch to ${themeMeta(target).label}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={toggleMode}
          aria-label={label}
        >
          {mode === "dark" ? (
            <Sun aria-hidden="true" />
          ) : (
            <Moon aria-hidden="true" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
