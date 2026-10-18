import type { ReactNode } from "react";
import { ConnectionEvidence } from "../ConnectionEvidence";

interface GraphConnectionEvidencePanelProps {
  source: { id: string; title: string };
  target: { id: string; title: string };
  onClose: () => void;
}

/** Evidence for the exact edge selected in the graph, without changing graph data. */
export function GraphConnectionEvidencePanel({
  source,
  target,
  onClose,
}: GraphConnectionEvidencePanelProps): ReactNode {
  return (
    <aside
      className="graph-connection-evidence"
      aria-label={`Connection evidence: ${source.title} to ${target.title}`}
    >
      <div className="graph-connection-evidence-head">
        <div>
          <p className="graph-connection-evidence-kicker mono">Relationship</p>
          <h3 className="serif">Connection evidence</h3>
        </div>
        <button
          type="button"
          className="graph-selection-clear"
          aria-label="Close connection evidence"
          onClick={onClose}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <p className="graph-connection-evidence-path mono">
        {source.title} → {target.title}
      </p>
      <ConnectionEvidence
        key={`${source.id}:${target.id}`}
        noteId={source.id}
        pair={{ sourceId: source.id, targetId: target.id }}
        emptyMessage="No recorded evidence for this relationship."
      />
    </aside>
  );
}
