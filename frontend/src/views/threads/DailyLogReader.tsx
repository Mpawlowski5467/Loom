import { ChevronRight, FileText } from "lucide-react";
import { Link } from "react-router";
import { noteHref } from "@/app/routes";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { notePathOf } from "@/api/notes";
import { Markdown } from "@/editor/Markdown";
import { MARKDOWN_PROSE } from "@/editor/markdownProse";
import { DigestSection } from "./DigestSection";
import { ReaderHeader } from "./ReaderHeader";
import { isToday, longDate, stampLabel } from "./threadDates";
import type { DailyThread, DayDigest } from "./threadModel";
import { authorOf, summaryOf } from "./threadText";
import { useHydratedBody } from "./useHydratedBody";

interface DailyLogReaderProps {
  thread: DailyThread;
  digest: DayDigest;
}

/** One day: who wrote it, a summary, then New notes, Flags and Links. */
export function DailyLogReader({ thread, digest }: DailyLogReaderProps) {
  const { note, date } = thread;
  const body = useHydratedBody(note);
  const author = authorOf(note);
  const summary = body.loading ? null : summaryOf(note.body);
  const from =
    author.id === "scribe"
      ? ` from ${isToday(date) ? "today's" : "that day's"} changelogs`
      : "";
  return (
    <article aria-labelledby="thread-title" className="flex flex-col gap-6">
      <ReaderHeader
        path={`threads/${notePathOf(note)}`}
        title={longDate(date)}
        byline={
          <>
            Written by {author.name}
            {from} ·{" "}
            <time dateTime={note.modified}>
              {stampLabel(note.modified, date)}
            </time>
          </>
        }
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to={noteHref(note)}>
              <FileText aria-hidden="true" />
              Open in Notes
            </Link>
          </Button>
        }
      />
      {summary === null ? (
        <div
          role="status"
          aria-label="Loading the log"
          className="flex flex-col gap-2"
        >
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : (
        <p className="font-editor text-base leading-relaxed text-secondary-foreground">
          {body.failed
            ? "Couldn't load this log's text."
            : summary || "This log has no summary yet."}
        </p>
      )}
      <DigestSection
        title="New notes"
        rows={digest.newNotes}
        empty="No notes were created this day."
      />
      <DigestSection
        title="Flags"
        rows={digest.flags}
        empty="Nothing was flagged."
      />
      <DigestSection
        title="Links"
        rows={digest.links}
        empty="Spider added no links."
      />
      {!body.loading && !body.failed && note.body.trim() && (
        <Collapsible className="flex flex-col gap-2">
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="group self-start text-muted-foreground"
            >
              <ChevronRight
                aria-hidden="true"
                className="transition-transform group-data-[state=open]:rotate-90"
              />
              Full log
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="rounded-lg border border-border px-4 py-2">
            <Markdown source={note.body} bodyClass={MARKDOWN_PROSE} />
          </CollapsibleContent>
        </Collapsible>
      )}
    </article>
  );
}
