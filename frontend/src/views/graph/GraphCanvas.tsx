import { CircleAlert, Waypoints } from "lucide-react";
import { useMemo, type KeyboardEvent, type RefObject } from "react";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { useApp } from "@/context/app-ctx";
import type { Note } from "@/data/types";
import type { VisibleGraphStats } from "@/graph/filtering";
import { ORBIT_SCENE_LABELS, type OrbitScene } from "@/graph/layouts";
import { GraphTimeline } from "./GraphTimeline";
import { GraphZoomControls } from "./GraphZoomControls";
import { timelineRange } from "./timeline";

interface GraphCanvasProps {
  hostRef: RefObject<HTMLDivElement | null>;
  overlayRef: RefObject<SVGSVGElement | null>;
  ringRef: RefObject<HTMLDivElement | null>;
  building: boolean;
  heavy: boolean;
  stagedScene: OrbitScene;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onFit: () => void;
  onZoom: (direction: 1 | -1) => void;
  stats: VisibleGraphStats;
  selectedNote: Note | null;
  isolate: boolean;
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

const pill =
  "pointer-events-none rounded-full border border-border bg-popover/90 px-3 py-1 font-mono text-[11px] text-muted-foreground shadow-overlay";

/** Sigma on a dot grid, with its overlays: ring, stats, timeline, zoom. */
export function GraphCanvas({
  hostRef,
  overlayRef,
  ringRef,
  building,
  heavy,
  stagedScene,
  onKeyDown,
  onFit,
  onZoom,
  stats,
  selectedNote,
  isolate,
}: GraphCanvasProps) {
  const app = useApp();
  const { notes, notesLoaded, notesError, graphFilter, setGraphFilter } = app;
  const range = useMemo(() => timelineRange(notes), [notes]);

  const loading = !notesLoaded && notes.length === 0;
  const loadFailed = notesLoaded && notesError !== null && notes.length === 0;
  const empty = notesLoaded && notesError === null && notes.length === 0;
  const filteredEmpty = notes.length > 0 && stats.nodes === 0;
  const ready = !loading && !loadFailed && !empty;

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-background bg-[radial-gradient(var(--border)_1px,transparent_1px)] bg-size-[20px_20px]">
      <div
        ref={hostRef}
        // Sigma focuses the host on every click, which Chrome reports as
        // :focus-visible; data-pointer limits the ring to keyboard focus.
        className="absolute inset-0 animate-in fade-in duration-500 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring data-pointer:outline-none"
        role="application"
        tabIndex={0}
        aria-label="Knowledge graph"
        aria-describedby="graph-keyboard-help"
        aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Enter Escape I F + -"
        onKeyDown={(e) => {
          delete e.currentTarget.dataset.pointer;
          onKeyDown(e);
        }}
        onBlur={(e) => delete e.currentTarget.dataset.pointer}
        onPointerDown={(e) => {
          e.currentTarget.dataset.pointer = "";
          e.currentTarget.focus({ preventScroll: true });
        }}
      />
      <p id="graph-keyboard-help" className="sr-only">
        Use arrow keys to select nearby notes, Enter to open the full editor, I
        for local only, F to fit, plus and minus to zoom, and Escape to close
        the note.
      </p>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {selectedNote
          ? `Selected ${selectedNote.title}`
          : "No graph node selected"}
      </p>
      <svg
        ref={overlayRef}
        className="pointer-events-none absolute inset-0 z-[4] size-full text-brand"
      />
      <div
        ref={ringRef}
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-0 z-[5] hidden rounded-full border-2 border-brand"
      />

      {loading && (
        <div
          role="status"
          className="absolute inset-0 grid place-items-center text-sm text-muted-foreground"
        >
          Loading your vault…
        </div>
      )}
      {loadFailed && (
        <div
          role="alert"
          className="absolute inset-0 z-10 grid place-items-center"
        >
          <EmptyState
            icon={<CircleAlert />}
            title="Couldn't load your vault"
            description={`${notesError}. Check the backend and reload.`}
          />
        </div>
      )}
      {empty && (
        <div className="absolute inset-0 grid place-items-center">
          <EmptyState
            icon={<Waypoints />}
            title="Your graph is empty"
            description="Capture a note to start weaving."
          />
        </div>
      )}
      {ready && filteredEmpty && (
        <div
          role="status"
          className="absolute inset-0 z-10 grid place-items-center"
        >
          <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
            No notes match these filters.
            <Button variant="outline" size="sm" onClick={app.resetGraphFilter}>
              Clear filters
            </Button>
          </div>
        </div>
      )}
      {ready && building && !filteredEmpty && (
        <div
          role="status"
          className="absolute inset-0 z-10 grid place-items-center text-sm text-muted-foreground"
        >
          Arranging {stats.nodes} notes…
        </div>
      )}

      {ready && (
        <div className="absolute top-3 left-3 z-10 flex flex-wrap gap-2">
          <span className={pill}>
            {stats.nodes === notes.length
              ? count(stats.nodes, "note")
              : `${stats.nodes} of ${count(notes.length, "note")}`}{" "}
            · {count(stats.edges, "link")}
            {isolate && selectedNote && ` · local to ${selectedNote.title}`}
            {heavy && " · animations paused (large graph)"}
          </span>
          {app.graphDisplay.layout !== "force" && (
            <span key={stagedScene} className={`${pill} animate-in fade-in`}>
              {ORBIT_SCENE_LABELS[stagedScene]}
            </span>
          )}
        </div>
      )}

      {ready && range && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center pr-16 pl-3">
          <div className="pointer-events-auto w-full max-w-xl">
            <GraphTimeline
              range={range}
              cutoff={graphFilter.createdBefore}
              onCutoffChange={(createdBefore) =>
                setGraphFilter({ createdBefore })
              }
            />
          </div>
        </div>
      )}
      <div className="absolute right-3 bottom-3 z-10">
        <GraphZoomControls
          onZoomIn={() => onZoom(1)}
          onZoomOut={() => onZoom(-1)}
          onFit={onFit}
          disabled={!ready || building}
        />
      </div>
    </div>
  );
}
