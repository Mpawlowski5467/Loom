import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Density, Motion, TextSize } from "@/theme/appearance";
import { useAppearance } from "@/theme/appearance-ctx";
import { SettingRow } from "./SettingRow";

interface Option<T extends string> {
  value: T;
  label: string;
}

const TEXT_SIZES: Option<TextSize>[] = [
  { value: "sm", label: "Small" },
  { value: "md", label: "Normal" },
  { value: "lg", label: "Large" },
];

const DENSITIES: Option<Density>[] = [
  { value: "compact", label: "Compact" },
  { value: "cozy", label: "Cozy" },
  { value: "comfortable", label: "Comfortable" },
];

const MOTIONS: Option<Motion>[] = [
  { value: "auto", label: "Follow system" },
  { value: "on", label: "Always on" },
  { value: "off", label: "Reduce motion" },
];

function Segmented<T extends string>({
  id,
  options,
  value,
  onChange,
}: {
  id: string;
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      aria-labelledby={id}
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next as T);
      }}
      className="w-fit"
    >
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value} className="px-4">
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** Text size, density and motion: kept from the previous Appearance page. */
export function ReadabilityRows() {
  const { settings, update } = useAppearance();
  return (
    <>
      <SettingRow title="Text size" titleId="appearance-text-size">
        <Segmented
          id="appearance-text-size"
          options={TEXT_SIZES}
          value={settings.textSize}
          onChange={(textSize) => update({ textSize })}
        />
      </SettingRow>
      <SettingRow title="Density" titleId="appearance-density">
        <Segmented
          id="appearance-density"
          options={DENSITIES}
          value={settings.density}
          onChange={(density) => update({ density })}
        />
      </SettingRow>
      <SettingRow
        title="Motion"
        titleId="appearance-motion"
        description="Reduce motion turns off graph animation and transitions."
      >
        <Segmented
          id="appearance-motion"
          options={MOTIONS}
          value={settings.motion}
          onChange={(motion) => update({ motion })}
        />
      </SettingRow>
    </>
  );
}
