import type { ReactNode } from "react";
import { Wikilink } from "../../components/primitives/Wikilink";
import type { Capture, Note } from "../../data/types";

interface Props {
  capture: Capture;
  isActive: boolean;
  isChecked: boolean;
  noteById: (id: string) => Note | undefined;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}

/** A single capture row in the triage list. */
export function CaptureCard({
  capture: c,
  isActive,
  isChecked,
  noteById,
  onSelect,
  onToggle,
}: Props): ReactNode {
  const filed = c.status === "done";
  const filedNote = filed && c.filedAs ? noteById(c.filedAs) : undefined;
  return (
    <div
      className="inbox-card"
      role="button"
      tabIndex={0}
      aria-current={isActive}
      onClick={() => onSelect(c.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(c.id);
        }
      }}
    >
      <input
        type="checkbox"
        className="inbox-card-check"
        checked={isChecked}
        onChange={() => onToggle(c.id)}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Select ${c.title}`}
      />
      <div className="inbox-card-body">
        <div className="inbox-card-h">
          <span className="inbox-card-title">{c.title}</span>
          {!filed && (
            <span
              className="status-badge"
              data-state={c.status === "processing" ? "running" : "queued"}
            >
              <span className="pulse-dot" />
              {c.status}
            </span>
          )}
        </div>
        <div className="inbox-card-meta">
          <span>{c.folder}/</span>
          <span>·</span>
          <span>
            {c.receivedAt.slice(11, 16)} · {c.receivedAt.slice(5, 10)}
          </span>
        </div>
        {filedNote && (
          <div className="inbox-card-filed">
            filed as <Wikilink target={filedNote.title} />
          </div>
        )}
      </div>
    </div>
  );
}
