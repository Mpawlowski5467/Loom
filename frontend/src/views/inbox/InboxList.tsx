import { Inbox, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useApp } from "@/context/app-ctx";
import type { Capture } from "@/data/types";
import type { InboxFilter } from "./captureHelpers";
import type { RowStatus } from "./captureStatus";
import { CaptureRow } from "./CaptureRow";
import { InlineCapture } from "./InlineCapture";
import type { useBulkSelection } from "./useBulkSelection";

interface InboxListProps {
  visible: readonly Capture[];
  counts: Record<InboxFilter, number>;
  filter: InboxFilter;
  onFilterChange: (f: InboxFilter) => void;
  search: string;
  onSearchChange: (q: string) => void;
  statusOf: (c: Capture) => RowStatus;
  selectable: (c: Capture) => boolean;
  selection: ReturnType<typeof useBulkSelection>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSkipSelected: () => void;
  onQueueSelected: () => void;
  jobsError: string | null;
}

const FILTERS: { value: InboxFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "review", label: "Needs review" },
  { value: "filed", label: "Filed" },
];

/** Quick capture, filter tabs, search, bulk actions and the capture rows. */
export function InboxList(p: InboxListProps) {
  const { captures, capturesLoaded, capturesError, setQuickCaptureOpen } =
    useApp();
  const sel = p.selection;
  const count = sel.selected.length;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <InlineCapture />
      <div className="flex flex-col gap-2 border-b border-border p-3">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          aria-label="Show"
          value={p.filter}
          onValueChange={(v) => v && p.onFilterChange(v as InboxFilter)}
          className="w-full"
        >
          {FILTERS.map((f) => (
            <ToggleGroupItem
              key={f.value}
              value={f.value}
              className="flex-1 gap-1.5 px-2 text-xs"
            >
              {f.label}
              <span className="font-mono text-[10px] text-muted-foreground">
                {p.counts[f.value]}
              </span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={p.search}
            onChange={(e) => p.onSearchChange(e.target.value)}
            placeholder="Search captures…"
            aria-label="Search captures"
            className="h-8 pl-8 text-sm"
          />
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={
              sel.allSelected
                ? true
                : sel.someSelected
                  ? "indeterminate"
                  : false
            }
            onCheckedChange={sel.toggleAll}
            disabled={sel.visibleIds.length === 0}
            aria-label="Select all"
          />
          <span>
            {count > 0
              ? `${count} selected`
              : `${p.visible.length} of ${captures.length}`}
          </span>
          <Button
            variant="ghost"
            size="xs"
            className="ml-auto"
            onClick={p.onSkipSelected}
            disabled={count === 0}
          >
            Skip
          </Button>
          <Button
            variant="outline"
            size="xs"
            onClick={p.onQueueSelected}
            disabled={sel.queueableCount === 0}
          >
            Queue
          </Button>
        </div>
        {p.jobsError && (
          <p role="alert" className="text-xs text-danger-foreground">
            Job updates unavailable: {p.jobsError}
          </p>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {p.visible.length === 0 &&
          (!capturesLoaded && captures.length === 0 ? (
            <p role="status" className="p-4 text-sm text-muted-foreground">
              Loading captures…
            </p>
          ) : capturesError && captures.length === 0 ? (
            <div role="alert" className="flex flex-col gap-1 p-4 text-sm">
              <span className="font-medium text-danger-foreground">
                Couldn’t load captures
              </span>
              <span className="text-muted-foreground">
                {capturesError}. Check the backend and reload.
              </span>
            </div>
          ) : captures.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-8 text-center">
              <Inbox
                aria-hidden="true"
                className="size-6 text-muted-foreground"
              />
              <span className="text-sm font-medium text-foreground">
                Inbox is clear
              </span>
              <span className="text-xs text-muted-foreground">
                Captures land here for triage. Keep a thought before it gets
                away.
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setQuickCaptureOpen(true)}
              >
                Quick capture
              </Button>
            </div>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">
              {p.search.trim()
                ? `No captures match “${p.search.trim()}”`
                : "Nothing here."}
            </p>
          ))}
        <ul aria-label="Captures">
          {p.visible.map((c) => (
            <CaptureRow
              key={c.id}
              capture={c}
              status={p.statusOf(c)}
              active={p.selectedId === c.id}
              checked={sel.ids.has(c.id) && p.selectable(c)}
              checkable={p.selectable(c)}
              onSelect={p.onSelect}
              onToggle={sel.toggle}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}
