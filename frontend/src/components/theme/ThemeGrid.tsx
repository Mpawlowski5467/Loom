import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { THEMES, isThemeId, type ThemeId } from "@/theme/registry";
import { ThemePreview } from "./ThemePreview";

interface ThemeGridProps {
  value: ThemeId;
  onChange: (theme: ThemeId) => void;
  className?: string;
}

/**
 * The six themes as a radio group of preview cards. Arrow keys move
 * between cards; choosing one calls `onChange` immediately.
 */
export function ThemeGrid({ value, onChange, className }: ThemeGridProps) {
  return (
    <RadioGroupPrimitive.Root
      aria-label="Theme"
      value={value}
      onValueChange={(next) => {
        if (isThemeId(next)) onChange(next);
      }}
      className={cn(
        "grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3",
        className,
      )}
    >
      {THEMES.map((theme) => (
        <RadioGroupPrimitive.Item
          key={theme.id}
          value={theme.id}
          aria-label={theme.label}
          className={cn(
            "group flex flex-col gap-2 rounded-lg border border-border bg-card p-2 text-left transition-colors outline-none",
            "hover:border-border-strong focus-visible:ring-2 focus-visible:ring-ring",
            "data-[state=checked]:border-brand",
          )}
        >
          <ThemePreview theme={theme.id} />
          <span className="flex items-start gap-2 px-1 pb-1">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-medium text-foreground">
                {theme.label}
              </span>
              <span className="text-xs text-muted-foreground">
                {theme.description}
              </span>
            </span>
            <span
              aria-hidden="true"
              className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-border-strong group-data-[state=checked]:border-brand"
            >
              <RadioGroupPrimitive.Indicator className="size-2 rounded-full bg-brand" />
            </span>
          </span>
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  );
}
