import { CommunityDot } from "@/components/CommunityDot";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Community } from "@/graph/communities";
import type { PaletteChip } from "./items";

const BASE: { value: PaletteChip; label: string }[] = [
  { value: "all", label: "All" },
  { value: "notes", label: "Notes" },
  { value: "actions", label: "Actions" },
  { value: "agents", label: "Agents" },
];

interface PaletteChipsProps {
  chip: PaletteChip;
  onChipChange: (chip: PaletteChip) => void;
  communities: readonly Community[];
  communitiesOn: boolean;
}

/** All / Notes / Actions / Agents, then one chip per community. */
export function PaletteChips({
  chip,
  onChipChange,
  communities,
  communitiesOn,
}: PaletteChipsProps) {
  const item =
    "h-7 shrink-0 gap-1.5 rounded-full border border-border px-3 text-xs data-[state=on]:border-brand data-[state=on]:bg-nav-active data-[state=on]:text-nav-active-foreground";
  return (
    <ToggleGroup
      type="single"
      aria-label="Show"
      value={chip}
      onValueChange={(v) => v && onChipChange(v as PaletteChip)}
      className="flex w-full flex-wrap justify-start gap-1.5 px-4 py-2"
    >
      {BASE.map((c) => (
        <ToggleGroupItem key={c.value} value={c.value} className={item}>
          {c.label}
        </ToggleGroupItem>
      ))}
      {communities
        .filter((c) => c.slot !== null)
        .map((c) => (
          <ToggleGroupItem
            key={c.slot}
            value={`community-${c.slot}`}
            className={`${item} max-w-44`}
            aria-label={`${c.label} community`}
            title={`Notes in the ${c.label} community`}
          >
            <CommunityDot
              slot={communitiesOn ? c.slot : null}
              className="size-2"
            />
            <span className="truncate">{c.label}</span>
          </ToggleGroupItem>
        ))}
    </ToggleGroup>
  );
}
