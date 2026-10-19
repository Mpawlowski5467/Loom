import { MessagesSquare } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useApp } from "@/context/app-ctx";
import { useIsDesktop } from "@/lib/useIsDesktop";
import { ActivityLog } from "./board/ActivityLog";
import { AgentsSection } from "./board/AgentsSection";
import { CouncilPanel } from "./board/council/CouncilPanel";
import { PulseMode } from "./board/PulseMode";
import { StatCards } from "./board/StatCards";
import { useBoardData } from "./board/useBoardData";

/**
 * Board: stats, the agents, their activity log | the Council. Below 1024px
 * the Council opens in a sheet.
 */
export function BoardView(): ReactNode {
  const { changelog, councilPrefill } = useApp();
  const { stats, stateCtx } = useBoardData();
  const [view, setView] = useState<"cards" | "pulse">("cards");
  const desktop = useIsDesktop();
  const [councilOpen, setCouncilOpen] = useState(councilPrefill !== null);

  return (
    <div className="flex min-h-0 flex-1">
      <main
        aria-labelledby="board-title"
        className="min-w-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-6">
          <header className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <h1
                id="board-title"
                className="text-xl font-semibold text-foreground"
              >
                Board
              </h1>
              <p className="text-sm text-muted-foreground">
                Every action goes through the read chain and Sentinel, and every
                change can be undone.
              </p>
            </div>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              aria-label="Agent view"
              value={view}
              onValueChange={(v) => v && setView(v as "cards" | "pulse")}
            >
              <ToggleGroupItem value="cards" className="px-3 text-xs">
                Cards
              </ToggleGroupItem>
              <ToggleGroupItem value="pulse" className="px-3 text-xs">
                Pulse
              </ToggleGroupItem>
            </ToggleGroup>
            {!desktop && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCouncilOpen(true)}
              >
                <MessagesSquare aria-hidden="true" />
                Council
              </Button>
            )}
          </header>
          <StatCards stats={stats} />
          {view === "cards" ? (
            <AgentsSection stats={stats} stateCtx={stateCtx} />
          ) : (
            <section aria-label="Agent pulse" className="flex flex-col gap-3">
              <h2 className="text-sm font-medium text-foreground">Agents</h2>
              <PulseMode stateCtx={stateCtx} />
            </section>
          )}
          <ActivityLog events={changelog} />
        </div>
      </main>
      {desktop ? (
        <div className="flex w-[380px] shrink-0 border-l border-border">
          <CouncilPanel />
        </div>
      ) : (
        <Sheet open={councilOpen} onOpenChange={setCouncilOpen}>
          <SheetContent side="right" className="w-[380px] max-w-full gap-0 p-0">
            <SheetTitle className="sr-only">Council</SheetTitle>
            <CouncilPanel />
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
