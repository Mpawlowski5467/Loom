import {
  Command as CommandIcon,
  Inbox,
  MessagesSquare,
  Network,
  Plus,
} from "lucide-react";
import type { ComponentType } from "react";
import { AgentAvatar } from "@/components/AgentAvatar";
import { CommunityDot } from "@/components/CommunityDot";
import { Kbd } from "@/components/shell/Kbd";
import { actorLabel } from "@/data/actors";
import { Highlight } from "./Highlight";
import type { ActionId, ActionItem, AgentItem, NoteItem } from "./items";

const ACTION_ICON: Record<ActionId, ComponentType<{ className?: string }>> = {
  capture: Inbox,
  council: MessagesSquare,
  spider: Network,
  "new-note": Plus,
  "quick-capture": CommandIcon,
};

export function NoteRow({
  item,
  query,
  communitiesOn,
}: {
  item: NoteItem;
  query: string;
  communitiesOn: boolean;
}) {
  return (
    <>
      <CommunityDot
        slot={communitiesOn ? item.slot : null}
        className="mt-1.5"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            <Highlight text={item.title} query={query} />
          </span>
          {item.note?.status === "superseded" && (
            <span className="font-mono text-[10px] text-muted-foreground uppercase">
              superseded
            </span>
          )}
          {item.folder && (
            <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
              {item.folder}
            </span>
          )}
        </span>
        {item.snippet && (
          <span className="line-clamp-1 text-xs text-muted-foreground">
            <Highlight text={item.snippet} query={query} />
          </span>
        )}
      </span>
    </>
  );
}

export function ActionRow({ item }: { item: ActionItem }) {
  const Icon = ACTION_ICON[item.id];
  return (
    <>
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
        {item.label}
      </span>
      {item.shortcut && <Kbd>{item.shortcut}</Kbd>}
    </>
  );
}

export function AgentRow({ item }: { item: AgentItem }) {
  const { agent } = item;
  return (
    <>
      <AgentAvatar actor={agent.name} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium text-foreground">
          {actorLabel(agent.name)}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {agent.role}
        </span>
      </span>
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span
          aria-hidden="true"
          className={
            agent.running
              ? "size-1.5 rounded-full bg-ok"
              : "size-1.5 rounded-full bg-border-strong"
          }
        />
        {agent.running ? "Running" : "Idle"}
      </span>
    </>
  );
}
