import { Command as CommandPrimitive } from "cmdk";
import { SearchIcon } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { Kbd } from "@/components/shell/Kbd";
import { Command } from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useApp } from "@/context/app-ctx";
import { useCommunitiesToggle } from "@/views/graph/useCommunitiesToggle";
import type { PaletteChip } from "./items";
import { PaletteChips } from "./PaletteChips";
import { PaletteFooter } from "./PaletteFooter";
import { PaletteList } from "./PaletteList";
import { PalettePreview } from "./PalettePreview";
import { SpiderConfirm } from "./SpiderConfirm";
import { usePaletteCommands } from "./usePaletteCommands";
import { usePaletteResults } from "./usePaletteResults";

/** Keep keys inside chips, preview and footer away from cmdk's Enter. */
const isolateKeys = (e: KeyboardEvent) => e.stopPropagation();

/**
 * ⌘K: hybrid search over notes plus actions and agents, with a preview of
 * the focused result and why it matched.
 */
export function CommandPalette() {
  const app = useApp();
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState<PaletteChip>("all");
  const [includeSuperseded, setIncludeSuperseded] = useState(false);
  // The focused item, remembered per result set: new results (a new query,
  // agents arriving) start again from the top.
  const [picked, setPicked] = useState<{ groups: unknown; value: string }>({
    groups: null,
    value: "",
  });
  const [communitiesOn] = useCommunitiesToggle();
  const { contextNote, state, search, groups, readout } = usePaletteResults(
    query,
    chip,
    includeSuperseded,
  );
  const cmd = usePaletteCommands(query);
  const items = [...groups.notes, ...groups.actions, ...groups.agents];
  const active = picked.groups === groups ? picked.value : "";
  const focused = items.find((i) => i.value === active) ?? items[0] ?? null;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && e.altKey) {
      e.preventDefault();
      if (focused?.kind === "note") cmd.showInGraph(focused.noteId);
    } else if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      void cmd.capture();
    } else if (e.altKey && e.code === "KeyS") {
      e.preventDefault();
      setIncludeSuperseded((on) => !on);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && app.setPaletteOpen(false)}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="backdrop-blur-sm"
        className="top-[10vh] flex h-[min(620px,80vh)] w-[calc(100%-2rem)] max-w-[960px] translate-y-0 flex-col gap-0 overflow-hidden bg-popover p-0 sm:max-w-[960px]"
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">
          Search notes, run actions and find agents.
        </DialogDescription>
        <Command
          label="Search notes, actions and agents"
          shouldFilter={false}
          loop
          value={focused?.value ?? ""}
          onValueChange={(value) => setPicked({ groups, value })}
          onKeyDown={onKeyDown}
          className="min-h-0 flex-1 rounded-none bg-transparent"
        >
          <div className="flex items-center gap-3 border-b border-border px-4">
            <SearchIcon
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
            <CommandPrimitive.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Search notes or capture a thought…"
              className="h-12 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            {readout && (
              <span
                className="shrink-0 font-mono text-xs text-muted-foreground"
                aria-live="polite"
              >
                {readout}
              </span>
            )}
            <Kbd>esc</Kbd>
          </div>
          <div onKeyDown={isolateKeys}>
            <PaletteChips
              chip={chip}
              onChipChange={setChip}
              communities={app.communities.communities}
              communitiesOn={communitiesOn}
            />
          </div>
          <div className="flex min-h-0 flex-1 border-t border-border">
            <div className="flex min-w-0 flex-1 flex-col md:max-w-[52%] md:border-r md:border-border">
              <PaletteList
                groups={groups}
                query={query}
                communitiesOn={communitiesOn}
                status={
                  state.status === "error"
                    ? `Search: ${state.message.replace(/\.$/, "")}. Matching titles and tags instead.`
                    : null
                }
                onSelect={cmd.select}
              />
            </div>
            <aside
              aria-label="Preview"
              onKeyDown={isolateKeys}
              className="hidden min-w-0 flex-1 flex-col overflow-y-auto md:flex"
            >
              <PalettePreview
                item={focused}
                search={search}
                communities={app.communities.communities}
                communitiesOn={communitiesOn}
                contextNote={contextNote}
                noteById={app.noteById}
                onOpen={cmd.openNote}
                onShowInGraph={cmd.showInGraph}
              />
            </aside>
          </div>
          <div onKeyDown={isolateKeys}>
            <PaletteFooter
              includeSuperseded={includeSuperseded}
              hiddenSuperseded={groups.hiddenSuperseded}
              onToggleSuperseded={() => setIncludeSuperseded((on) => !on)}
            />
          </div>
        </Command>
        {cmd.spiderTarget && (
          <SpiderConfirm
            note={cmd.spiderTarget}
            onConfirm={() => cmd.runSpider(cmd.spiderTarget!)}
            onClose={cmd.cancelSpider}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
