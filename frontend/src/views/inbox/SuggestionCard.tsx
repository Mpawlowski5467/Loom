import type { ReactNode } from "react";
import { Button } from "../../components/primitives/Button";
import { Chip } from "../../components/primitives/Chip";
import { Wikilink } from "../../components/primitives/Wikilink";
import { AgentBlob } from "../../components/primitives/AgentBlob";
import type { CardData } from "./types";

interface Props {
  data: CardData;
  onAccept: () => void;
  onEdit: () => void;
  onSkip: () => void;
}

/** One Weaver suggestion, fed from either a demo seed or a fetched preview. */
export function SuggestionCard({
  data,
  onAccept,
  onEdit,
  onSkip,
}: Props): ReactNode {
  return (
    <div className="inbox-suggest">
      <div className="inbox-suggest-h">
        <AgentBlob agent="weaver" state="running" size={22} />
        Weaver suggestion
      </div>
      <div className="inbox-suggest-row">
        <span className="label">type</span>
        <Chip type={data.type}>{data.type}</Chip>
        <span className="label label-gap">folder</span>
        <Chip>{data.destFolder}/</Chip>
        <span className="label label-gap">title</span>
        <span className="inbox-suggest-title">{data.title}</span>
      </div>
      <div className="inbox-suggest-row">
        <span className="label">tags</span>
        {data.tags.length === 0 && (
          <span className="inbox-suggest-none">none</span>
        )}
        {data.tags.map((t) => (
          <Chip key={t}>#{t}</Chip>
        ))}
      </div>
      <div className="inbox-suggest-row">
        <span className="label">links</span>
        {data.links.length === 0 && (
          <span className="inbox-suggest-none">none</span>
        )}
        {data.links.map((l) => (
          <span key={l.key} className="inbox-suggest-link">
            <Wikilink target={l.title} />
            {l.decision === "suggested" && (
              <span className="inbox-suggest-tag">suggested</span>
            )}
          </span>
        ))}
      </div>
      <div className="inbox-suggest-actions">
        <Button variant="amber" size="md" onClick={onAccept}>
          accept &amp; file
        </Button>
        <Button onClick={onEdit}>edit suggestion</Button>
        <Button onClick={onSkip}>skip</Button>
        <span className="inbox-kbd-hint">j/k move · e edit · ↵ file</span>
      </div>
    </div>
  );
}
