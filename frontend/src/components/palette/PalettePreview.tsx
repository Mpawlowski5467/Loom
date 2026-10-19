import { Map as MapIcon, SquareArrowOutUpRight } from "lucide-react";
import type { VaultSearch } from "@/api/search";
import { AgentAvatar } from "@/components/AgentAvatar";
import { CommunityDot } from "@/components/CommunityDot";
import { Kbd } from "@/components/shell/Kbd";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { actorLabel } from "@/data/actors";
import type { Note } from "@/data/types";
import type { Community } from "@/graph/communities";
import type { ActionItem, AgentItem, NoteItem, PaletteItem } from "./items";
import { explainMatch } from "./match";
import { WhyItMatched } from "./WhyItMatched";

interface PalettePreviewProps {
  item: PaletteItem | null;
  search: VaultSearch | null;
  communities: readonly Community[];
  communitiesOn: boolean;
  contextNote: Note | null;
  noteById: (id: string) => Note | undefined;
  onOpen: (noteId: string) => void;
  onShowInGraph: (noteId: string) => void;
}

/** Details of the focused result. */
export function PalettePreview(p: PalettePreviewProps) {
  if (!p.item)
    return (
      <p className="p-5 text-sm text-muted-foreground">
        Type to search notes, run an action or find an agent.
      </p>
    );
  if (p.item.kind === "note") return <NotePreview {...p} item={p.item} />;
  if (p.item.kind === "action") return <ActionPreview item={p.item} />;
  return <AgentPreview item={p.item} />;
}

function NotePreview(p: PalettePreviewProps & { item: NoteItem }) {
  const { item, search } = p;
  const note = item.note;
  const community = p.communities.find((c) => c.slot === item.slot);
  const path = note
    ? [note.folder, note.filename ?? `${note.id}.md`].filter(Boolean).join("/")
    : item.noteId;
  const hit = item.hit;
  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-1.5">
        <p
          className="truncate font-mono text-xs text-muted-foreground"
          title={path}
        >
          {path}
        </p>
        <h3 className="text-lg font-semibold text-foreground">{item.title}</h3>
        <div className="flex flex-wrap items-center gap-1.5">
          {note && <Badge variant="outline">{note.type}</Badge>}
          {community && (
            <Badge variant="outline" className="gap-1.5">
              <CommunityDot
                slot={p.communitiesOn ? community.slot : null}
                className="size-2"
              />
              {community.label}
            </Badge>
          )}
          {note?.status === "superseded" && (
            <Badge variant="secondary">superseded</Badge>
          )}
          {note?.tags.slice(0, 4).map((t) => (
            <Badge
              key={t}
              variant="secondary"
              className="font-mono text-[11px]"
            >
              #{t}
            </Badge>
          ))}
        </div>
      </div>
      {item.snippet && (
        <p className="line-clamp-4 text-sm leading-relaxed text-secondary-foreground">
          {item.snippet}
        </p>
      )}
      {hit && search && (
        <WhyItMatched
          explanation={explainMatch(hit, search, {
            contextNote: p.contextNote,
            noteById: p.noteById,
          })}
        />
      )}
      <div className="mt-auto flex flex-wrap gap-2">
        <Button size="sm" onClick={() => p.onOpen(item.noteId)}>
          <SquareArrowOutUpRight aria-hidden="true" />
          Open
          <Kbd className="border-transparent bg-primary-foreground/15 text-primary-foreground">
            ↵
          </Kbd>
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => p.onShowInGraph(item.noteId)}
        >
          <MapIcon aria-hidden="true" />
          Show in graph
          <Kbd>⌥↵</Kbd>
        </Button>
      </div>
    </div>
  );
}

function ActionPreview({ item }: { item: ActionItem }) {
  return (
    <div className="flex flex-col gap-2 p-5">
      <h3 className="text-base font-semibold text-foreground">{item.label}</h3>
      <p className="text-sm text-secondary-foreground">{item.detail}</p>
      {item.id === "spider" && (
        <p className="text-sm text-muted-foreground">
          This writes links to your vault; you'll be asked to confirm, and each
          link can be undone from the note's history.
        </p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Press <Kbd>↵</Kbd> to run.
      </p>
    </div>
  );
}

function AgentPreview({ item }: { item: AgentItem }) {
  const { agent } = item;
  return (
    <div className="flex flex-col gap-3 p-5">
      <div className="flex items-center gap-3">
        <AgentAvatar actor={agent.name} size="md" />
        <div>
          <h3 className="text-base font-semibold text-foreground">
            {actorLabel(agent.name)}
          </h3>
          <p className="text-xs text-muted-foreground">
            {agent.layer === "shuttle" ? "Shuttle layer" : "Loom layer"} ·{" "}
            {agent.running ? "Running" : "Idle"}
          </p>
        </div>
      </div>
      <p className="text-sm text-secondary-foreground">{agent.role}</p>
      <p className="text-xs text-muted-foreground">
        Press <Kbd>↵</Kbd> to open it on Board.
      </p>
    </div>
  );
}
