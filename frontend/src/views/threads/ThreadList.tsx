import { CalendarDays, MessagesSquare, Sunrise } from "lucide-react";
import type {
  CouncilThreadRef,
  DailyThread,
  StandupThread,
} from "./threadModel";
import { shortDate } from "./threadDates";
import { ThreadListSection } from "./ThreadListSection";

interface ThreadListProps {
  daily: readonly DailyThread[];
  standups: readonly StandupThread[];
  councils: readonly CouncilThreadRef[];
  councilError: boolean;
  selectedId: string | null;
}

const meta = (text: string, srSuffix?: string) => (
  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
    {text}
    {srSuffix && <span className="sr-only"> {srSuffix}</span>}
  </span>
);

/** Daily logs by date with counts, then Standups, then Council chats. */
export function ThreadList({
  daily,
  standups,
  councils,
  councilError,
  selectedId,
}: ThreadListProps) {
  return (
    <nav aria-label="Threads" className="flex flex-col gap-4 p-3">
      <ThreadListSection
        title="Daily logs"
        icon={CalendarDays}
        selectedId={selectedId}
        empty="Scribe hasn't written a daily log yet."
        rows={daily.map((t) => ({
          id: t.id,
          label: shortDate(t.date),
          meta: meta(
            String(t.count),
            `new ${t.count === 1 ? "note" : "notes"}`,
          ),
        }))}
      />
      <ThreadListSection
        title="Standups"
        icon={Sunrise}
        selectedId={selectedId}
        empty="No Standup recaps yet."
        rows={standups.map((t) => ({
          id: t.id,
          label: shortDate(t.date),
          meta: t.capture ? meta("Inbox") : undefined,
        }))}
      />
      <ThreadListSection
        title="Council chats"
        icon={MessagesSquare}
        selectedId={selectedId}
        empty={
          councilError
            ? "Couldn't load Council chats."
            : "No saved Council chats yet."
        }
        rows={councils.map((t) => ({ id: t.id, label: shortDate(t.date) }))}
      />
    </nav>
  );
}
