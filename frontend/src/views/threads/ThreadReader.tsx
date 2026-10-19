import { MessagesSquare, SearchX } from "lucide-react";
import { Link } from "react-router";
import { TAB_PATHS } from "@/app/routes";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CouncilReader } from "./CouncilReader";
import { DailyLogReader } from "./DailyLogReader";
import { StandupReader } from "./StandupReader";
import type { DayDigest, ThreadItem } from "./threadModel";

interface ThreadReaderProps {
  selected: ThreadItem | null;
  digest: DayDigest | null;
  loading: boolean;
  /** The URL named a thread (so nothing selected means it's missing). */
  requested: boolean;
}

/** The open thread, or what to show while there isn't one. */
export function ThreadReader({
  selected,
  digest,
  loading,
  requested,
}: ThreadReaderProps) {
  if (selected?.kind === "daily" && digest)
    return (
      <DailyLogReader key={selected.id} thread={selected} digest={digest} />
    );
  if (selected?.kind === "standup")
    return <StandupReader key={selected.id} thread={selected} />;
  if (selected?.kind === "council")
    return <CouncilReader key={selected.id} date={selected.date} />;
  if (loading)
    return (
      <div
        role="status"
        aria-label="Loading threads"
        className="flex flex-col gap-3"
      >
        <Skeleton className="h-3 w-48" />
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  if (!requested)
    return (
      <EmptyState
        icon={<MessagesSquare />}
        title="No threads yet"
        description="Scribe writes a daily log from the agents' changelogs. Standup recaps and saved Council chats show up here too."
      />
    );
  return (
    <EmptyState
      icon={<SearchX />}
      title="This thread isn't here"
      description="It may have been archived, or the link is from another vault."
      action={
        <Button variant="outline" size="sm" asChild>
          <Link to={TAB_PATHS.threads}>Back to Threads</Link>
        </Button>
      }
    />
  );
}
