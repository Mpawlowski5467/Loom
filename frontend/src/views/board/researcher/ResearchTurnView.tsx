import { Check, Inbox, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/editor/Markdown";
import { MARKDOWN_PROSE } from "@/editor/markdownProse";
import { cn } from "@/lib/utils";
import { SourceCards } from "./SourceCards";
import type { ResearchTurn } from "./useResearcher";

function formatTime(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

interface ResearchTurnViewProps {
  turn: ResearchTurn;
  saving: boolean;
  busy: boolean;
  onSave: () => void;
}

/** A question (right) or an answer with its sources and Save to Inbox. */
export function ResearchTurnView({
  turn,
  saving,
  busy,
  onSave,
}: ResearchTurnViewProps) {
  const user = turn.role === "user";
  return (
    <article className={cn("flex flex-col gap-2", user && "items-end")}>
      <div className="flex gap-2 text-[11px] text-muted-foreground">
        <span>{user ? "You" : "Researcher"}</span>
        <time dateTime={turn.timestamp}>{formatTime(turn.timestamp)}</time>
      </div>
      {user ? (
        <p className="max-w-[85%] rounded-2xl rounded-br-md bg-brand px-3 py-2 text-sm text-brand-foreground">
          {turn.content}
        </p>
      ) : (
        <div className="flex w-full flex-col gap-3 rounded-lg border border-border bg-card p-3">
          <Markdown
            source={turn.content || "Researcher returned an empty answer."}
            bodyClass={MARKDOWN_PROSE}
          />
          {turn.sources !== undefined && <SourceCards sources={turn.sources} />}
          {turn.question &&
            (turn.savedToInbox ? (
              <span
                role="status"
                className="flex items-center gap-1.5 text-xs text-ok-foreground"
              >
                <Check aria-hidden="true" className="size-3.5" />
                Saved to Inbox
              </span>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="self-start"
                onClick={onSave}
                disabled={busy}
                aria-label="Save this research to Inbox"
              >
                {saving ? (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                ) : (
                  <Inbox aria-hidden="true" />
                )}
                Save to Inbox
              </Button>
            ))}
        </div>
      )}
    </article>
  );
}
