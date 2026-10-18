import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { useAppearance } from "@/theme/appearance-ctx";
import { GRAPH_PALETTES, type GraphPalette } from "@/theme/registry";
import { SettingRow } from "./SettingRow";

const LEGEND = [
  { label: "Community 1", dot: "bg-community-1" },
  { label: "Community 2", dot: "bg-community-2" },
  { label: "Community 3", dot: "bg-community-3" },
  { label: "Community 4", dot: "bg-community-4" },
];

/** Graph community colors: the theme's palette or Okabe-Ito. */
export function GraphColorsControl() {
  const { settings, update } = useAppearance();
  return (
    <SettingRow
      title="Graph colors"
      titleId="appearance-graph-colors"
      description="Colorblind-safe uses the Okabe-Ito palette in every theme."
    >
      <div className="flex flex-wrap items-center gap-6">
        <ToggleGroup
          type="single"
          variant="outline"
          aria-labelledby="appearance-graph-colors"
          value={settings.graphPalette}
          onValueChange={(value) => {
            if (value) update({ graphPalette: value as GraphPalette });
          }}
          className="w-fit"
        >
          {GRAPH_PALETTES.map((palette) => (
            <ToggleGroupItem
              key={palette.id}
              value={palette.id}
              className="px-4"
            >
              {palette.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ul className="flex flex-wrap gap-4" aria-label="Community colors">
          {LEGEND.map((item) => (
            <li
              key={item.label}
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <span className={cn("size-2.5 rounded-full", item.dot)} />
              {item.label}
            </li>
          ))}
        </ul>
      </div>
    </SettingRow>
  );
}
