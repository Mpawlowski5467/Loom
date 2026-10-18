import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useApp } from "@/context/app-ctx";
import { computeVisibleGraphStats } from "@/graph/filtering";
import { notePassesFilter } from "@/graph/nodeFilter";
import { GraphCanvas } from "./graph/GraphCanvas";
import { GraphSidebar } from "./graph/GraphSidebar";
import { GraphToolbar } from "./graph/GraphToolbar";
import { GraphNotePanel } from "./graph/panel/GraphNotePanel";
import { useCommunitiesToggle } from "./graph/useCommunitiesToggle";
import { useGraphCanvas } from "./graph/useGraphCanvas";
import { useIsDesktop } from "./graph/useIsDesktop";

/**
 * Graph: vault sidebar (folders, communities) | canvas with zoom and the
 * timeline | the selected note, open beside the graph.
 */
export function GraphView(): ReactNode {
  const app = useApp();
  const { notes, graphFilter: filter, setGraphFilter, communities } = app;
  const { graphSelectedId, setGraphSelectedId, treeVisible, setTreeVisible } =
    app;
  const [communitiesOn, setCommunitiesOn] = useCommunitiesToggle();
  const [isolate, setIsolate] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const desktop = useIsDesktop();

  const selectedNote = useMemo(
    () => notes.find((n) => n.id === graphSelectedId) ?? null,
    [notes, graphSelectedId],
  );
  const clearSelection = useCallback(() => {
    setIsolate(false);
    setGraphSelectedId(null);
  }, [setGraphSelectedId]);

  // Selection lives in AppContext across tabs. Drop it when the note is gone
  // or an explicit filter hides it; the timeline only dims it.
  const selectionHidden =
    selectedNote !== null &&
    !notePassesFilter(
      selectedNote,
      { ...filter, createdBefore: null },
      communities.slotOf,
    );
  const stale =
    app.notesLoaded &&
    graphSelectedId !== null &&
    (!selectedNote || selectionHidden);
  useEffect(() => {
    if (stale) setGraphSelectedId(null);
  }, [stale, setGraphSelectedId]);
  // Local only needs a selection: drop it when the selection goes (a click on
  // empty canvas, a stale note) so the next selection starts unfocused.
  if (!graphSelectedId && isolate) setIsolate(false);

  const { hostRef, overlayRef, ringRef, exportAs, ...canvas } = useGraphCanvas({
    notes,
    filter,
    communities,
    communitiesOn,
    isolate,
    setIsolate,
    clearSelection,
  });
  const stats = useMemo(
    () =>
      computeVisibleGraphStats(
        notes,
        filter,
        { selectedId: graphSelectedId, isolateNeighbors: isolate },
        communities.slotOf,
      ),
    [notes, filter, graphSelectedId, isolate, communities.slotOf],
  );

  const crumbs = [app.config?.active_vault || "vault"];
  if (filter.folder) crumbs.push(filter.folder);
  if (filter.community !== null)
    crumbs.push(
      communities.communities.find(
        (c) => (c.slot ?? "other") === filter.community,
      )?.label ?? "Community",
    );
  if (selectedNote) crumbs.push(selectedNote.title);

  const sidebar = <GraphSidebar communitiesOn={communitiesOn} />;
  return (
    <div className="relative flex min-h-0 flex-1">
      {desktop && treeVisible && (
        <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-sidebar">
          {sidebar}
        </aside>
      )}
      <Sheet open={!desktop && sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetTitle className="sr-only">Graph filters</SheetTitle>
          {sidebar}
        </SheetContent>
      </Sheet>

      <section
        aria-label="Graph"
        className="relative flex min-w-0 flex-1 flex-col"
      >
        <GraphToolbar
          crumbs={crumbs}
          communitiesOn={communitiesOn}
          onCommunitiesChange={setCommunitiesOn}
          showSuperseded={filter.showSuperseded}
          onShowSupersededChange={(on) =>
            setGraphFilter({ showSuperseded: on })
          }
          localOnly={isolate && selectedNote !== null}
          onLocalOnlyChange={setIsolate}
          localOnlyDisabled={!selectedNote}
          onToggleSidebar={() =>
            desktop ? setTreeVisible(!treeVisible) : setSheetOpen(true)
          }
          onExport={exportAs}
        />
        <GraphCanvas
          hostRef={hostRef}
          overlayRef={overlayRef}
          ringRef={ringRef}
          building={canvas.building}
          heavy={canvas.heavy}
          stagedScene={canvas.stagedScene}
          onKeyDown={canvas.onKeyDown}
          onFit={canvas.fit}
          onZoom={canvas.zoom}
          stats={stats}
          selectedNote={selectedNote}
          isolate={isolate}
        />
      </section>

      {selectedNote && (
        <div className="absolute inset-y-0 right-0 z-20 flex w-full max-w-[520px] shadow-overlay lg:static lg:z-auto lg:w-[520px] lg:shrink-0 lg:shadow-none">
          <GraphNotePanel
            key={selectedNote.id}
            note={selectedNote}
            onClose={clearSelection}
            onSelectNote={(id) => app.flyToNode(id)}
          />
        </div>
      )}
    </div>
  );
}
