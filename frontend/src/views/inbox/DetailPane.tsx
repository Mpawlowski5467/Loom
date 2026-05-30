import type { ReactNode } from "react";
import { Button } from "../../components/primitives/Button";
import { AgentBlob } from "../../components/primitives/AgentBlob";
import { renderMarkdown } from "../../editor/renderMarkdown";
import { SuggestionCard } from "./SuggestionCard";
import { toNodeType, type CardData, type CardLink } from "./types";
import type { CapturePreview } from "../../api/captures";
import type { Capture, Note } from "../../data/types";

/** Per-capture state of the lazily-fetched Weaver preview. */
export type PreviewState =
  | { status: "ready"; preview: CapturePreview }
  | { status: "error"; message: string };

interface Props {
  capture: Capture;
  preview: PreviewState | undefined;
  noteById: (id: string) => Note | undefined;
  onAccept: () => void;
  onEdit: () => void;
  onSkip: () => void;
  onRetry: (id: string) => void;
}

function Loading({ label }: { label: string }): ReactNode {
  return (
    <div className="inbox-processing" role="status" aria-live="polite">
      <div className="inbox-suggest-h">
        <AgentBlob agent="weaver" state="running" size={22} />
        {label}
      </div>
      <div className="inbox-skeleton" aria-hidden="true">
        <span className="sk-line" />
        <span className="sk-line short" />
        <span className="sk-line" />
      </div>
    </div>
  );
}

/** The right-hand reading + triage pane for the selected capture. */
export function DetailPane({
  capture,
  preview,
  noteById,
  onAccept,
  onEdit,
  onSkip,
  onRetry,
}: Props): ReactNode {
  const actions = { onAccept, onEdit, onSkip };

  const renderSuggestion = (): ReactNode => {
    // Demo captures carry a seed suggestion; real ones use the fetched preview.
    if (capture.suggestion) {
      const data: CardData = {
        type: capture.suggestion.type,
        destFolder: capture.suggestion.destFolder,
        title: capture.suggestion.title,
        tags: capture.suggestion.tags,
        links: capture.suggestion.links
          .map((id) => {
            const n = noteById(id);
            return n ? { key: id, title: n.title } : null;
          })
          .filter((x): x is CardLink => x !== null),
      };
      return <SuggestionCard data={data} {...actions} />;
    }

    if (!preview) return <Loading label="Weaver is reading this capture…" />;

    if (preview.status === "error") {
      return (
        <div className="inbox-suggest" role="status">
          <div className="inbox-suggest-h">
            <AgentBlob agent="weaver" state="idle" size={22} />
            Weaver suggestion
          </div>
          <p className="inbox-suggest-err">{preview.message}</p>
          <div className="inbox-suggest-actions">
            <Button size="md" onClick={() => onRetry(capture.id)}>
              retry
            </Button>
          </div>
        </div>
      );
    }

    const p = preview.preview;
    const data: CardData = {
      type: toNodeType(p.note_type),
      destFolder: p.folder,
      title: p.title,
      tags: p.tags,
      links: p.links.map((l) => ({
        key: l.note_id || l.title,
        title: l.title,
        decision: l.decision,
      })),
    };
    return <SuggestionCard data={data} {...actions} />;
  };

  const triaging = capture.status !== "done" && capture.status !== "processing";

  return (
    <div className="inbox-detail">
      <div className="inbox-detail-title">{capture.title}</div>
      <div className="inbox-detail-meta">
        <span>{capture.folder}/</span>
        <span>
          received {capture.receivedAt.slice(5, 16).replace("T", " ")}
        </span>
      </div>
      {renderMarkdown(capture.body, { bodyClass: "inbox-detail-body" })}

      {capture.status === "processing" && (
        <Loading label="Weaver is filing this capture…" />
      )}
      {triaging && renderSuggestion()}
      {capture.status === "done" && (
        <div className="inbox-suggest inbox-filed">
          <div className="inbox-suggest-h inbox-filed-h">✓ filed</div>
          <div className="inbox-filed-body">
            This capture has been processed.
          </div>
        </div>
      )}
    </div>
  );
}
