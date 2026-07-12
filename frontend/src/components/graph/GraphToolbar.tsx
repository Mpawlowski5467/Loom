import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Download, Maximize2 } from "lucide-react";
import type { Note, NodeType } from "../../data/types";
import { NODE_TYPES } from "../../graph/filtering";
import { Popover } from "../primitives/Popover";
import { GearIcon } from "../primitives/icons";
import { DisplayControls } from "./DisplayControls";

export type ExportFormat = "png" | "svg" | "json";

interface Props {
  graphFilters: Set<NodeType>;
  toggleGraphFilter: (t: NodeType) => void;
  clearGraphFilters: () => void;
  notes?: Pick<Note, "type">[];
  onExport?: (format: ExportFormat) => void;
  onFitView?: () => void;
  fitDisabled?: boolean;
}

export function GraphToolbar({
  graphFilters,
  toggleGraphFilter,
  clearGraphFilters,
  notes = [],
  onExport,
  onFitView,
  fitDisabled = false,
}: Props): ReactNode {
  const [displayOpen, setDisplayOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const exportRef = useRef<HTMLDivElement | null>(null);
  const counts = new Map<NodeType, number>();
  for (const note of notes) {
    counts.set(note.type, (counts.get(note.type) ?? 0) + 1);
  }

  useEffect(() => {
    if (!exportOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!exportRef.current?.contains(e.target as Node)) {
        setExportOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [exportOpen]);

  const handleExport = (format: ExportFormat) => {
    setExportOpen(false);
    onExport?.(format);
  };

  return (
    <div className="graph-toolbar">
      <div className="graph-filters" role="group" aria-label="Filter by type">
        {NODE_TYPES.map((type) => {
          const active = graphFilters.has(type);
          const count = counts.get(type) ?? 0;
          const action = active
            ? graphFilters.size === 1
              ? "Show all note types"
              : `Hide ${type} notes`
            : graphFilters.size === 0
              ? `Show only ${type} notes`
              : `Show ${type} notes`;
          return (
            <button
              key={type}
              className="graph-filter"
              aria-pressed={active}
              aria-label={`${action} (${count})`}
              title={`${type} · ${count}`}
              onClick={() => toggleGraphFilter(type)}
            >
              <span className={`dot dot-${type}`} />
            </button>
          );
        })}
        {graphFilters.size > 0 && (
          <button
            className="graph-filters-clear"
            aria-label="Clear filters"
            title="Clear filters"
            onClick={clearGraphFilters}
          >
            ×
          </button>
        )}
      </div>
      <div className="graph-toolbar-right">
        <button
          type="button"
          className="graph-display-trigger"
          aria-label="Fit visible nodes"
          title="Fit visible nodes (F)"
          onClick={onFitView}
          disabled={fitDisabled || !onFitView}
        >
          <Maximize2 size={14} aria-hidden="true" />
        </button>
        <div ref={exportRef} className="graph-export">
          <button
            type="button"
            className="graph-display-trigger"
            aria-label="Export graph"
            aria-haspopup="menu"
            aria-expanded={exportOpen}
            onClick={() => setExportOpen((v) => !v)}
            disabled={!onExport}
          >
            <Download size={14} aria-hidden="true" />
          </button>
          {exportOpen && (
            <ul className="graph-export-menu" role="menu">
              <li>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleExport("png")}
                >
                  PNG
                </button>
              </li>
              <li>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleExport("svg")}
                >
                  SVG
                </button>
              </li>
              <li>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleExport("json")}
                >
                  JSON
                </button>
              </li>
            </ul>
          )}
        </div>
        <button
          ref={triggerRef}
          type="button"
          className="graph-display-trigger"
          aria-label="Display settings"
          aria-expanded={displayOpen}
          onClick={() => setDisplayOpen((v) => !v)}
        >
          <GearIcon />
        </button>
        <Popover
          anchorRef={triggerRef}
          open={displayOpen}
          onClose={() => setDisplayOpen(false)}
          className="graph-display-popover"
        >
          <DisplayControls />
        </Popover>
      </div>
    </div>
  );
}
