import { Check, Pencil } from "lucide-react";
import { useState } from "react";
import type { CaptureJob } from "@/api/captures";
import type { CaptureProposal } from "@/api/proposals";
import { Kbd } from "@/components/shell/Kbd";
import { Button } from "@/components/ui/button";
import type { Capture } from "@/data/types";
import { cn } from "@/lib/utils";
import { CaptureHeader } from "./CaptureHeader";
import { JobStateCard } from "./JobStateCard";
import { ProposalCard } from "./ProposalCard";
import type { PreviewState } from "./usePreviews";

interface DetailPaneProps {
  capture: Capture;
  job?: CaptureJob;
  jobBusy: boolean;
  canQueue: boolean;
  preview: PreviewState | undefined;
  proposal: CaptureProposal | undefined;
  onApprove: () => void;
  onEdit: () => void;
  onDiscard: () => void;
  onRetryPreview: () => void;
  onEnqueue: () => void;
  onRetryJob: () => void;
  onCancelJob: () => void;
  onOpenDraft?: () => void;
  onMerged: () => void;
}

const ACTIVE = new Set([
  "queued",
  "running",
  "retrying",
  "needs_review",
  "failed",
  "completed",
]);

/** The selected capture: where it came from, what it says, and the proposal. */
export function DetailPane(p: DetailPaneProps) {
  const { capture: c, job } = p;
  const [full, setFull] = useState(false);
  const triaging = c.status === "pending" && !(job && ACTIVE.has(job.status));
  const ready = Boolean(c.suggestion) || p.preview?.status === "ready";
  const long = c.body.length > 1200;

  return (
    <article
      aria-labelledby="capture-title"
      className="flex min-h-0 flex-1 flex-col"
    >
      {/* Focusable so keyboard users can scroll a long capture. */}
      <div
        tabIndex={0}
        aria-label="Capture details"
        role="region"
        className="min-h-0 flex-1 overflow-y-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-5 px-6 py-6">
          <CaptureHeader capture={c} />
          <blockquote
            aria-label="Capture content"
            className={cn(
              "border-l-2 border-border-strong pl-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-secondary-foreground",
              long &&
                !full &&
                "max-h-72 overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]",
            )}
          >
            {c.body || "Empty capture."}
          </blockquote>
          {long && (
            <Button
              variant="link"
              size="xs"
              className="-mt-3 h-auto self-start p-0"
              onClick={() => setFull((v) => !v)}
            >
              {full ? "Show less" : "Show the whole capture"}
            </Button>
          )}
          {c.sourceCoverage?.complete === false && (
            <p
              role="alert"
              className="rounded-md border border-warning-border bg-warning p-3 text-sm text-warning-foreground"
            >
              This capture is larger than Weaver's safe extraction limit. The
              original source is kept, and nothing past the limit was dropped
              silently.
            </p>
          )}
          <JobStateCard
            capture={c}
            job={job}
            busy={p.jobBusy}
            onCancel={p.onCancelJob}
            onRetry={p.onRetryJob}
            onEnqueue={p.onEnqueue}
            onDiscard={p.onDiscard}
            onOpenDraft={p.onOpenDraft}
          />
          {triaging && (
            <ProposalCard
              capture={c}
              preview={p.preview}
              proposal={p.proposal}
              onRetry={p.onRetryPreview}
              onMerged={p.onMerged}
              onSeparate={p.onApprove}
            />
          )}
          {triaging && p.canQueue && job?.status !== "cancelled" && (
            <div className="flex items-center gap-3 rounded-lg border border-dashed border-border p-3 text-sm">
              <p className="flex-1 text-secondary-foreground">
                Or run the full pipeline in the background and keep working.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={p.onEnqueue}
                disabled={p.jobBusy}
              >
                {p.jobBusy ? "Queueing…" : "Queue processing"}
              </Button>
            </div>
          )}
        </div>
      </div>
      {triaging && (
        <footer className="flex flex-wrap items-center gap-2 border-t border-border px-6 py-3">
          <Button
            onClick={p.onApprove}
            disabled={!ready}
            aria-keyshortcuts="Enter"
          >
            <Check aria-hidden="true" />
            Approve and file
          </Button>
          <Button
            variant="outline"
            onClick={p.onEdit}
            disabled={!ready}
            aria-keyshortcuts="E"
          >
            <Pencil aria-hidden="true" />
            Edit first
          </Button>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            <Kbd>j</Kbd> <Kbd>k</Kbd> move · <Kbd>↵</Kbd> file · <Kbd>e</Kbd>{" "}
            edit
          </span>
          <Button
            variant="destructive"
            className="ml-auto"
            onClick={p.onDiscard}
          >
            Discard
          </Button>
        </footer>
      )}
    </article>
  );
}
