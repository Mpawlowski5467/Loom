import { useState } from "react";
import { AgentAvatar } from "@/components/AgentAvatar";
import { Button } from "@/components/ui/button";
import { actorLabel } from "@/data/actors";
import { cn } from "@/lib/utils";
import { CouncilText } from "./councilText";

interface AgentMessageProps {
  agent: string;
  body: string;
  error?: string;
  traceId?: string;
  /** Long contributions start clamped; the summary is the main answer. */
  clamp?: boolean;
  onRawCall: (traceId: string) => void;
}

/** One agent's message: avatar and name on the left, then the text. */
export function AgentMessage(p: AgentMessageProps) {
  const [open, setOpen] = useState(false);
  const long = p.clamp && p.body.length > 220;
  return (
    <div className="flex gap-2.5">
      <AgentAvatar actor={p.agent} size="md" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-foreground">
            {actorLabel(p.agent)}
          </span>
          {p.traceId && (
            <Button
              variant="link"
              size="xs"
              className="h-auto p-0 text-[11px] text-muted-foreground"
              onClick={() => p.onRawCall(p.traceId!)}
              aria-label={`View ${actorLabel(p.agent)}'s raw LLM call`}
            >
              Raw call
            </Button>
          )}
        </div>
        <p
          className={cn(
            "text-sm leading-relaxed whitespace-pre-wrap",
            p.error ? "text-danger-foreground" : "text-secondary-foreground",
            long && !open && "line-clamp-4",
          )}
        >
          {p.error ? (
            `Couldn't answer: ${p.error}`
          ) : (
            <CouncilText text={p.body} />
          )}
        </p>
        {long && (
          <Button
            variant="link"
            size="xs"
            className="h-auto self-start p-0 text-[11px]"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "Show less" : "Show more"}
          </Button>
        )}
      </div>
    </div>
  );
}
