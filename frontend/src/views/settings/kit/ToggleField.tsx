import type { ReactNode } from "react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface ToggleFieldProps {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

/** An on/off setting: a switch with its label (and a line of detail). */
export function ToggleField({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  className,
}: ToggleFieldProps) {
  return (
    <label
      className={cn(
        "flex items-start justify-between gap-4 text-sm",
        disabled && "opacity-60",
        className,
      )}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium text-foreground">{label}</span>
        {description && (
          <span className="text-muted-foreground">{description}</span>
        )}
      </span>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="mt-0.5"
      />
    </label>
  );
}
