import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { BRAND_HEX, brandIdForHex } from "@/theme/appearance";
import { useAppearance } from "@/theme/appearance-ctx";
import {
  BRAND_OVERRIDES,
  isBrandOverride,
  type BrandOverride,
} from "@/theme/registry";
import { SettingRow } from "./SettingRow";

/** Static class names so Tailwind sees them; values live in themes.css. */
const SWATCH_CLASS: Record<BrandOverride, string> = {
  blue: "bg-(--swatch-blue)",
  teal: "bg-(--swatch-teal)",
  amber: "bg-(--swatch-amber)",
  violet: "bg-(--swatch-violet)",
  rose: "bg-(--swatch-rose)",
};

const DEFAULT_VALUE = "default";

const swatchClass =
  "size-7 rounded-full outline-none ring-offset-2 ring-offset-background transition-shadow " +
  "focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:ring-2 data-[state=checked]:ring-foreground";

/** Theme default plus the five accent overrides, as round swatches. */
export function AccentSwatches() {
  const { settings, resolvedTheme, update } = useAppearance();
  const selected = brandIdForHex(settings.brandOverride);
  const selectedLabel =
    BRAND_OVERRIDES.find((b) => b.id === selected)?.label ?? "Theme default";

  return (
    <SettingRow
      title="Accent color"
      titleId="appearance-accent"
      description="Used for focus rings, selection and highlights. Light themes use a deeper shade of the same hue."
    >
      <div className="flex flex-wrap items-center gap-4">
        <RadioGroupPrimitive.Root
          aria-labelledby="appearance-accent"
          orientation="horizontal"
          value={selected ?? DEFAULT_VALUE}
          onValueChange={(value) =>
            update({
              brandOverride: isBrandOverride(value) ? BRAND_HEX[value] : null,
            })
          }
          className="flex flex-wrap items-center gap-3"
        >
          <RadioGroupPrimitive.Item
            value={DEFAULT_VALUE}
            aria-label="Theme default"
            className={cn(swatchClass, "p-0")}
          >
            {/* Re-scoping data-theme restores the theme's own --brand. */}
            <span
              data-theme={resolvedTheme}
              className="block size-full rounded-full bg-brand"
            />
          </RadioGroupPrimitive.Item>
          {BRAND_OVERRIDES.map((brand) => (
            <RadioGroupPrimitive.Item
              key={brand.id}
              value={brand.id}
              aria-label={brand.label}
              className={cn(swatchClass, SWATCH_CLASS[brand.id])}
            />
          ))}
        </RadioGroupPrimitive.Root>
        <span className="text-sm text-secondary-foreground" aria-live="polite">
          {selectedLabel}
        </span>
      </div>
    </SettingRow>
  );
}
