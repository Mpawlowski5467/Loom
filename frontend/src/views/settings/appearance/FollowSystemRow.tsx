import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAppearance } from "@/theme/appearance-ctx";
import {
  isThemeId,
  themeMeta,
  themesForMode,
  type ThemeId,
  type ThemeMode,
} from "@/theme/registry";
import { SettingRow } from "./SettingRow";

function ModeSelect({
  mode,
  label,
  value,
  onChange,
}: {
  mode: ThemeMode;
  label: string;
  value: ThemeId;
  onChange: (id: ThemeId) => void;
}) {
  const id = `appearance-${mode}-theme`;
  return (
    <div className="flex min-w-48 flex-1 flex-col gap-1.5">
      <Label htmlFor={id} className="text-muted-foreground">
        {label}
      </Label>
      <Select
        value={value}
        onValueChange={(next) => {
          if (isThemeId(next)) onChange(next);
        }}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {themesForMode(mode).map((theme) => (
            <SelectItem key={theme} value={theme}>
              {themeMeta(theme).label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Follow the OS light/dark preference, with a theme for each mode. */
export function FollowSystemRow() {
  const { settings, update } = useAppearance();
  return (
    <SettingRow
      title="Follow system"
      description="Switch between your dark and light theme when the operating system does."
    >
      <div className="flex items-center gap-3">
        <Switch
          id="appearance-follow-system"
          checked={settings.followSystem}
          onCheckedChange={(on) => update({ followSystem: on })}
        />
        <Label htmlFor="appearance-follow-system">
          Follow system appearance
        </Label>
      </div>
      <div className="flex flex-wrap gap-4">
        <ModeSelect
          mode="dark"
          label="When the system is dark"
          value={settings.darkTheme}
          onChange={(id) => update({ darkTheme: id })}
        />
        <ModeSelect
          mode="light"
          label="When the system is light"
          value={settings.lightTheme}
          onChange={(id) => update({ lightTheme: id })}
        />
      </div>
    </SettingRow>
  );
}
