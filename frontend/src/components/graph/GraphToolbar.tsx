import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Download } from "lucide-react";
import type { GraphMode, NodeType } from "../../data/types";
import { ModeToggle } from "../primitives/ModeToggle";
import { Popover } from "../primitives/Popover";
import { GearIcon } from "../primitives/icons";
import { DisplayControls } from "./DisplayControls";

const TYPE_FILTERS: { type: NodeType; label: string }[] = [
  { type: "project", label: "project" },
  { type: "topic", label: "topic" },
  { type: "people", label: "people" },
  { type: "daily", label: "daily" },
  { type: "capture", label: "capture" },
  { type: "custom", label: "custom" },
];

export type ExportFormat = "png" | "svg" | "json";

interface Props {
  graphMode: GraphMode;
  setGraphMode: (m: GraphMode) => void;
  graphFilters: Set<string>;
  toggleGraphFilter: (t: string) => void;
  onExport?: (format: ExportFormat) => void;
}

export function GraphToolbar({
  graphMode,
  setGraphMode,
  graphFilters,
  toggleGraphFilter,
  onExport,
}: Props): ReactNode {
  const [displayOpen, setDisplayOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const exportRef = useRef<HTMLDivElement | null>(null);

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
        {TYPE_FILTERS.map((f) => (
          <button
            key={f.type}
            className="graph-filter"
            aria-pressed={graphFilters.has(f.type)}
            onClick={() => toggleGraphFilter(f.type)}
          >
            <span className={`dot dot-${f.type}`} />
            {f.label}
          </button>
        ))}
      </div>
      <div className="graph-toolbar-right">
        <ModeToggle
          value={graphMode}
          onChange={setGraphMode}
          ariaLabel="Graph layout"
          options={[
            { value: "constellation", icon: "✦", label: "constellation" },
            { value: "orbit", icon: "◎", label: "orbit" },
          ]}
        />
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
