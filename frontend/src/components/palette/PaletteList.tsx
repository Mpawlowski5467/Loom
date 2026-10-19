import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { ActionRow, AgentRow, NoteRow } from "./PaletteRows";
import type { PaletteGroups, PaletteItem } from "./items";

const itemClass =
  "items-start gap-2.5 rounded-md px-2 py-2 data-[selected=true]:bg-accent";

interface PaletteListProps {
  groups: PaletteGroups;
  query: string;
  communitiesOn: boolean;
  /** Shown above the groups (searching, offline). */
  status: string | null;
  onSelect: (item: PaletteItem) => void;
}

/** Notes, then Actions, then Agents. */
export function PaletteList({
  groups,
  query,
  communitiesOn,
  status,
  onSelect,
}: PaletteListProps) {
  const headingClass =
    "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase";
  return (
    <CommandList className="max-h-none min-h-0 flex-1 px-2 pb-2">
      {status && (
        <p role="status" className="px-2 pt-3 text-sm text-muted-foreground">
          {status}
        </p>
      )}
      <CommandEmpty className="py-8 text-center text-sm text-muted-foreground">
        {query.trim() ? "No matches." : "Nothing here yet."}
      </CommandEmpty>
      {groups.notes.length > 0 && (
        <CommandGroup
          heading={query.trim() ? "Notes" : "Recent notes"}
          className={headingClass}
        >
          {groups.notes.map((item) => (
            <CommandItem
              key={item.value}
              value={item.value}
              onSelect={() => onSelect(item)}
              className={itemClass}
            >
              <NoteRow
                item={item}
                query={query}
                communitiesOn={communitiesOn}
              />
            </CommandItem>
          ))}
        </CommandGroup>
      )}
      {groups.actions.length > 0 && (
        <CommandGroup heading="Actions" className={headingClass}>
          {groups.actions.map((item) => (
            <CommandItem
              key={item.value}
              value={item.value}
              onSelect={() => onSelect(item)}
              className={itemClass}
            >
              <ActionRow item={item} />
            </CommandItem>
          ))}
        </CommandGroup>
      )}
      {groups.agents.length > 0 && (
        <CommandGroup heading="Agents" className={headingClass}>
          {groups.agents.map((item) => (
            <CommandItem
              key={item.value}
              value={item.value}
              onSelect={() => onSelect(item)}
              className={itemClass}
            >
              <AgentRow item={item} />
            </CommandItem>
          ))}
        </CommandGroup>
      )}
    </CommandList>
  );
}
