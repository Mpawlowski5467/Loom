import { RotateCcw } from "lucide-react";
import { ThemeGrid } from "@/components/theme/ThemeGrid";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { APPEARANCE_DEFAULTS, appearanceEquals } from "@/theme/appearance";
import { useAppearance } from "@/theme/appearance-ctx";
import { AccentSwatches } from "./appearance/AccentSwatches";
import { EditorFontControl } from "./appearance/EditorFontControl";
import { FollowSystemRow } from "./appearance/FollowSystemRow";
import { GraphColorsControl } from "./appearance/GraphColorsControl";
import { ReadabilityRows } from "./appearance/ReadabilityRows";
import { SettingRow } from "./appearance/SettingRow";

/** Settings → Appearance. Every change applies to the whole app at once. */
export function AppearanceSection() {
  const { settings, resolvedTheme, savedTo, setTheme, update } =
    useAppearance();
  const isDefault = appearanceEquals(settings, APPEARANCE_DEFAULTS);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col px-1 pb-10">
      <header className="flex flex-wrap items-end justify-between gap-3 pb-2">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">
            Appearance
          </h2>
          <p className="text-sm text-muted-foreground">
            {savedTo === "vault"
              ? "Saved to this vault."
              : "Saved on this device. This backend can't store appearance settings in the vault yet."}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={isDefault}
          onClick={() => update(APPEARANCE_DEFAULTS)}
        >
          <RotateCcw aria-hidden="true" />
          Reset to defaults
        </Button>
      </header>

      <SettingRow title="Theme">
        <ThemeGrid value={resolvedTheme} onChange={setTheme} />
      </SettingRow>
      <Separator />
      <FollowSystemRow />
      <Separator />
      <AccentSwatches />
      <Separator />
      <EditorFontControl />
      <Separator />
      <GraphColorsControl />
      <Separator />
      <ReadabilityRows />
    </div>
  );
}
