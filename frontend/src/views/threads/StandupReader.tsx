import { FileText, Inbox } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { captureRelPath } from "@/api/captures";
import { notePathOf } from "@/api/notes";
import { noteHref, TAB_PATHS } from "@/app/routes";
import { Button } from "@/components/ui/button";
import { useApp } from "@/context/app-ctx";
import { Markdown } from "@/editor/Markdown";
import { MARKDOWN_PROSE } from "@/editor/markdownProse";
import { ReaderHeader } from "./ReaderHeader";
import { stampLabel } from "./threadDates";
import type { StandupThread } from "./threadModel";
import { useHydratedBody } from "./useHydratedBody";

/** A Standup recap, from the Inbox (not filed yet) or a filed note. */
export function StandupReader({ thread }: { thread: StandupThread }) {
  const { selectCapture } = useApp();
  const navigate = useNavigate();
  const body = useHydratedBody(thread.note);
  const { capture, note } = thread;
  const path = capture ? captureRelPath(capture) : note ? notePathOf(note) : "";
  const at = capture?.receivedAt ?? note?.created ?? "";
  return (
    <article aria-labelledby="thread-title" className="flex flex-col gap-6">
      <ReaderHeader
        path={`threads/${path}`}
        title={thread.title}
        byline={
          <>
            Written by Standup ·{" "}
            <time dateTime={at}>{stampLabel(at, thread.date)}</time>
            {capture && " · waiting in the Inbox"}
          </>
        }
        actions={
          capture ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                selectCapture(capture.id);
                void navigate(TAB_PATHS.inbox);
              }}
            >
              <Inbox aria-hidden="true" />
              Open in Inbox
            </Button>
          ) : note ? (
            <Button variant="outline" size="sm" asChild>
              <Link to={noteHref(note)}>
                <FileText aria-hidden="true" />
                Open in Notes
              </Link>
            </Button>
          ) : null
        }
      />
      {body.loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading the recap…
        </p>
      ) : body.failed ? (
        <p role="alert" className="text-sm text-danger-foreground">
          Couldn't load this recap.
        </p>
      ) : (
        <Markdown
          source={thread.note?.body ?? thread.body}
          bodyClass={MARKDOWN_PROSE}
        />
      )}
    </article>
  );
}
