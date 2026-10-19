import { Checkbox } from "@/components/ui/checkbox";

interface CheckboxFieldProps {
  label: string;
  hint: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

/** One option of a connection: a checkbox with its label and a hint. */
export function CheckboxField({
  label,
  hint,
  checked,
  onCheckedChange,
}: CheckboxFieldProps) {
  return (
    <label className="flex items-start gap-2.5 text-sm">
      <Checkbox
        checked={checked}
        onCheckedChange={(next) => onCheckedChange(next === true)}
        className="mt-0.5"
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}
