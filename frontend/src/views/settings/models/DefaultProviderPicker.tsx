import { useId } from "react";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { PROVIDER_BY_NAME, type ProviderName } from "../providerModels";

interface DefaultProviderPickerProps {
  names: ProviderName[];
  value: ProviderName | "";
  onChange: (name: ProviderName) => void;
}

/** One radio per configured provider; picking one saves it right away. */
export function DefaultProviderPicker({
  names,
  value,
  onChange,
}: DefaultProviderPickerProps) {
  const id = useId();
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border bg-card px-4 py-3">
      <span id={id} className="text-sm font-medium text-foreground">
        Default provider
      </span>
      {names.length === 0 ? (
        <span className="text-sm text-muted-foreground">
          At least one provider must be configured.
        </span>
      ) : (
        <RadioGroup
          aria-labelledby={id}
          value={value}
          onValueChange={(next) => onChange(next as ProviderName)}
          className="flex flex-wrap gap-x-4 gap-y-2"
        >
          {names.map((name) => (
            <div key={name} className="flex items-center gap-2">
              <RadioGroupItem id={`${id}-${name}`} value={name} />
              <Label
                htmlFor={`${id}-${name}`}
                className="font-normal text-secondary-foreground"
              >
                {PROVIDER_BY_NAME.get(name)?.label ?? name}
              </Label>
            </div>
          ))}
        </RadioGroup>
      )}
    </div>
  );
}
