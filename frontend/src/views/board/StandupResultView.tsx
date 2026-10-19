import { CalendarDays, Inbox } from "lucide-react";
import type { StandupResult } from "@/api/automations";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/editor/Markdown";
import { MARKDOWN_PROSE } from "@/editor/markdownProse";

interface StandupResultViewProps {
  result: StandupResult | null;
  onOpenInbox: () => void;
}

/** The generated recap, or what to do before there is one. */
export function StandupResultView({
  result,
  onOpenInbox,
}: StandupResultViewProps) {
  return (
    <>
      {!result && (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <CalendarDays
            aria-hidden="true"
            className="size-6 text-muted-foreground"
          />
          <strong className="text-sm font-medium text-foreground">
            Choose a date to prepare its recap.
          </strong>
          <span className="text-sm text-muted-foreground">
            The result is saved as one deduplicated Inbox capture.
          </span>
        </div>
      )}
      {result && result.recap && (
        <article className="flex flex-col gap-3">
          <p className="flex gap-3 font-mono text-xs text-muted-foreground">
            <span>{result.notes_modified} notes touched</span>
            <span>{result.calendar_events} calendar events</span>
          </p>
          {result.calendar_error && (
            <p role="alert" className="text-sm text-warning-foreground">
              Calendar: {result.calendar_error}
            </p>
          )}
          <Markdown source={result.recap} bodyClass={MARKDOWN_PROSE} />
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={onOpenInbox}
          >
            <Inbox aria-hidden="true" /> Open in Inbox
          </Button>
        </article>
      )}
      {result && !result.recap && (
        <div className="flex flex-col items-center gap-1 py-8 text-center text-sm">
          <strong className="font-medium text-foreground">
            No activity found for {result.date}.
          </strong>
          <span className="text-muted-foreground">No capture was created.</span>
          {result.calendar_error && (
            <span role="alert" className="text-warning-foreground">
              Calendar: {result.calendar_error}
            </span>
          )}
        </div>
      )}
    </>
  );
}
