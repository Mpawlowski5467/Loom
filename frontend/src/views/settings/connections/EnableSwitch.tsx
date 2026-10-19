import { Switch } from "@/components/ui/switch";

interface EnableSwitchProps {
  /** Accessible name of the switch. */
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Visible state when on ("Enabled", "Scheduled"). */
  onText?: string;
}

/** A connection's master switch, with its state spelled out beside it. */
export function EnableSwitch({
  label,
  checked,
  onCheckedChange,
  disabled,
  onText = "Enabled",
}: EnableSwitchProps) {
  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      <Switch
        aria-label={label}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
      <span>{checked ? onText : "Off"}</span>
    </label>
  );
}
