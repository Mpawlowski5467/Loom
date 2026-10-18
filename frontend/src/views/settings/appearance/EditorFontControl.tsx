import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { useAppearance } from "@/theme/appearance-ctx";
import { EDITOR_FONTS, type EditorFont } from "@/theme/registry";
import { SettingRow } from "./SettingRow";

const FONT_CLASS: Record<EditorFont, string> = {
  geist: "font-sans",
  mono: "font-mono",
  serif: "font-serif",
};

/** Editor typeface, with each option set in its own face and a live sample. */
export function EditorFontControl() {
  const { settings, update } = useAppearance();
  return (
    <SettingRow
      title="Editor font"
      titleId="appearance-editor-font"
      description="The typeface for note bodies. The rest of the interface stays in Geist."
    >
      <ToggleGroup
        type="single"
        variant="outline"
        aria-labelledby="appearance-editor-font"
        value={settings.editorFont}
        onValueChange={(value) => {
          if (value) update({ editorFont: value as EditorFont });
        }}
        className="w-fit"
      >
        {EDITOR_FONTS.map((font) => (
          <ToggleGroupItem
            key={font.id}
            value={font.id}
            className={cn("px-4", FONT_CLASS[font.id])}
          >
            {font.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <p className="max-w-prose rounded-md border border-border bg-muted px-4 py-3 font-editor text-base leading-[1.7] text-secondary-foreground">
        The cache plan sets a p95 budget of 120 ms and links back to{" "}
        <span className="rounded-sm bg-chip px-1.5 py-0.5 text-chip-foreground">
          latency-budget
        </span>{" "}
        so both notes stay in step.
      </p>
    </SettingRow>
  );
}
