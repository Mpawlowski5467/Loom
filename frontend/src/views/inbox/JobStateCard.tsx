import { CircleCheck, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import type { CaptureJob } from "@/api/captures";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/data/formatDate";
import type { Capture } from "@/data/types";
import { cn } from "@/lib/utils";

interface JobStateCardProps {
  capture: Capture;
  job: CaptureJob | undefined;
  busy: boolean;
  onCancel: () => void;
  onRetry: () => void;
  onEnqueue: () => void;
  onDiscard: () => void;
  onOpenDraft?: () => void;
}

function Card({
  title,
  tone,
  role,
  children,
}: {
  title: string;
  tone: "info" | "warn" | "ok";
  role: "status" | "alert";
  children?: ReactNode;
}) {
  return (
    <section
      role={role}
      aria-live={role === "status" ? "polite" : undefined}
      className={cn(
        "flex flex-col gap-2 rounded-lg border p-4 text-sm",
        tone === "warn" &&
          "border-warning-border bg-warning text-warning-foreground",
        tone === "ok" && "border-ok/40 bg-ok/10 text-ok-foreground",
        tone === "info" && "border-border bg-card text-secondary-foreground",
      )}
    >
      <h3 className="font-medium">{title}</h3>
      {children}
    </section>
  );
}

const actions = "flex flex-wrap gap-2 pt-1";

/** Where the capture is in processing, and what you can do about it. */
export function JobStateCard(p: JobStateCardProps) {
  const { capture: c, job, busy } = p;
  if (c.status === "processing" || job?.status === "running")
    return (
      <p
        role="status"
        className="flex items-center gap-2 text-sm text-muted-foreground"
      >
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        Weaver is filing this capture…
      </p>
    );
  if (job?.status === "queued")
    return (
      <Card title="Queued" tone="info" role="status">
        <p>Waiting for a worker. It keeps its place if Loom restarts.</p>
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          onClick={p.onCancel}
          disabled={busy}
        >
          {busy ? "Cancelling…" : "Cancel job"}
        </Button>
      </Card>
    );
  if (job?.status === "retrying")
    return (
      <Card
        title={`Retrying · attempt ${job.attempts + 1} of ${job.max_attempts}`}
        tone="info"
        role="status"
      >
        <p>
          Loom will retry automatically
          {job.next_attempt_at
            ? ` after ${formatDateTime(job.next_attempt_at)}`
            : " shortly"}
          .
        </p>
        {job.error && (
          <p className="font-mono text-xs text-danger-foreground">
            {job.error}
          </p>
        )}
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          onClick={p.onCancel}
          disabled={busy}
        >
          {busy ? "Cancelling…" : "Cancel retry"}
        </Button>
      </Card>
    );
  const review = job
    ? job.status === "needs_review"
    : c.status === "needs_review";
  if (review)
    return (
      <Card title="Needs review" tone="warn" role="alert">
        <p>
          Sentinel kept this capture in the Inbox because it couldn't safely
          publish it. Check the reason, then retry the pipeline or discard the
          capture.
        </p>
        {c.validationReasons && c.validationReasons.length > 0 && (
          <ul className="list-disc pl-5">
            {c.validationReasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
        {job?.error && <p className="font-mono text-xs">{job.error}</p>}
        <div className={actions}>
          {p.onOpenDraft && (
            <Button size="sm" variant="outline" onClick={p.onOpenDraft}>
              Open draft note
            </Button>
          )}
          <Button size="sm" onClick={p.onRetry} disabled={busy}>
            {busy ? "Queueing…" : "Retry processing"}
          </Button>
          <Button size="sm" variant="destructive" onClick={p.onDiscard}>
            Discard
          </Button>
        </div>
      </Card>
    );
  if (job ? job.status === "failed" : c.status === "failed")
    return (
      <Card title="Processing failed" tone="warn" role="alert">
        <p>
          Loom left this capture in the Inbox. Retry the pipeline, or discard
          the capture if it isn't useful.
        </p>
        {(job?.error || c.lastError) && (
          <p className="font-mono text-xs">{job?.error || c.lastError}</p>
        )}
        {job?.recommended_action && (
          <p>
            <strong>Next:</strong> {job.recommended_action}
          </p>
        )}
        <div className={actions}>
          <Button size="sm" onClick={p.onRetry} disabled={busy}>
            {busy ? "Queueing…" : "Retry processing"}
          </Button>
          <Button size="sm" variant="destructive" onClick={p.onDiscard}>
            Discard
          </Button>
        </div>
      </Card>
    );
  if (job?.status === "cancelled")
    return (
      <Card title="Processing cancelled" tone="info" role="status">
        <p>The capture is still in your Inbox and can be queued again.</p>
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          onClick={p.onEnqueue}
          disabled={busy}
        >
          {busy ? "Queueing…" : "Queue again"}
        </Button>
      </Card>
    );
  if (job?.status === "completed")
    return (
      <Card title="Processing complete" tone="ok" role="status">
        <p>
          {job.note_title
            ? `Filed as ${job.note_title}.`
            : "Loom finished this capture. The Inbox will refresh shortly."}
        </p>
      </Card>
    );
  if (c.status === "done")
    return (
      <p
        role="status"
        className="flex items-center gap-2 text-sm text-ok-foreground"
      >
        <CircleCheck aria-hidden="true" className="size-4" />
        Filed. This capture has been processed.
      </p>
    );
  return null;
}
