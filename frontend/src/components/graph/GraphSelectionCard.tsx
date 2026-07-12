import type { ReactNode } from "react";
import type { Note } from "../../data/types";
import { Dot } from "../primitives/Dot";

export interface GraphSelectionCardProps {
  note: Pick<Note, "title" | "type" | "tags">;
  connectionCount: number;
  neighborsOnly: boolean;
  onNeighborsOnlyChange: (checked: boolean) => void;
  onOpenNote: () => void;
  onCenterNode?: () => void;
  onClearSelection: () => void;
}

const MAX_VISIBLE_TAGS = 3;

export function GraphSelectionCard({
  note,
  connectionCount,
  neighborsOnly,
  onNeighborsOnlyChange,
  onOpenNote,
  onCenterNode,
  onClearSelection,
}: GraphSelectionCardProps): ReactNode {
  const connectionLabel = `${connectionCount} ${
    connectionCount === 1 ? "connection" : "connections"
  }`;
  const visibleTags = note.tags.slice(0, MAX_VISIBLE_TAGS);

  return (
    <aside
      className="graph-selection-card"
      aria-label={`Node details: ${note.title}`}
    >
      <div className="graph-selection-card-head">
        <div className="graph-selection-type mono">
          <Dot type={note.type} className="graph-selection-type-dot" />
          <span>{note.type}</span>
        </div>
        <button
          type="button"
          className="graph-selection-clear"
          aria-label="Clear node selection"
          title="Clear node selection"
          onClick={onClearSelection}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>

      <h3 className="graph-selection-title serif">{note.title}</h3>
      <p className="graph-selection-count mono">{connectionLabel}</p>

      {visibleTags.length > 0 && (
        <ul className="graph-selection-tags mono" aria-label="Tags">
          {visibleTags.map((tag, index) => (
            <li key={`${tag}-${index}`}>#{tag}</li>
          ))}
        </ul>
      )}

      <div className="graph-selection-controls">
        <label className="graph-selection-neighbors">
          <input
            type="checkbox"
            role="switch"
            checked={neighborsOnly}
            aria-label="Show selected note and direct neighbors only"
            onChange={(event) =>
              onNeighborsOnlyChange(event.currentTarget.checked)
            }
          />
          <span>Neighbors only</span>
        </label>
        <div className="graph-selection-actions">
          {onCenterNode && (
            <button type="button" onClick={onCenterNode}>
              Center
            </button>
          )}
          <button
            type="button"
            className="graph-selection-open"
            onClick={onOpenNote}
          >
            Open note
          </button>
        </div>
      </div>
    </aside>
  );
}
