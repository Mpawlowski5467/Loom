import { MessagesSquare } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { TAB_PATHS } from "@/app/routes";
import { TraceModal } from "@/components/TraceModal";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CouncilThread } from "../board/council/CouncilThread";
import { ReaderHeader } from "./ReaderHeader";
import { isToday, longDate } from "./threadDates";
import { useCouncilDay } from "./useCouncilChats";

/** A saved Council chat, read-only; today's continues on the Board. */
export function CouncilReader({ date }: { date: string }) {
  const { messages, error } = useCouncilDay(date);
  const [trace, setTrace] = useState<string | null>(null);
  const asked = messages?.filter((m) => m.who === "you").length ?? 0;
  return (
    <article aria-labelledby="thread-title" className="flex flex-col gap-6">
      <ReaderHeader
        path={`agents/_council/chat/${date}.md`}
        title={longDate(date)}
        byline={
          messages
            ? `Loom Council · ${asked} ${asked === 1 ? "question" : "questions"}`
            : "Loom Council"
        }
        actions={
          isToday(date) && (
            <Button variant="outline" size="sm" asChild>
              <Link to={TAB_PATHS.board}>
                <MessagesSquare aria-hidden="true" />
                Continue on the Board
              </Link>
            </Button>
          )
        }
      />
      {error ? (
        <p role="alert" className="text-sm text-danger-foreground">
          Couldn't load this chat: {error}
        </p>
      ) : messages === null ? (
        <div
          role="status"
          aria-label="Loading the chat"
          className="flex flex-col gap-3"
        >
          <Skeleton className="ml-auto h-9 w-1/2" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : messages.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing was saved for this day.
        </p>
      ) : (
        <CouncilThread messages={messages} onRawCall={setTrace} />
      )}
      {trace && <TraceModal traceId={trace} onClose={() => setTrace(null)} />}
    </article>
  );
}
