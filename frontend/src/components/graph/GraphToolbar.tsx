import { useRef, useState } from "react";
import type { ReactNode } from "react";
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

interface Props {
  graphMode: GraphMode;
  setGraphMode: (m: GraphMode) => void;
  graphFilters: Set<string>;
  toggleGraphFilter: (t: string) => void;
}

export function GraphToolbar({
  graphMode,
  setGraphMode,
  graphFilters,
  toggleGraphFilter,
}: Props): ReactNode {
  const [displayOpen, setDisplayOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

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
