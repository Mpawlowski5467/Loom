import { ChevronRight, Loader2, RotateCcw } from "lucide-react";
import { useState } from "react";
import type { DuplicateEvidence } from "@/api/captureReview";
import type { CapturePreview } from "@/api/captures";
import type { CaptureProposal } from "@/api/proposals";
import { AgentAvatar } from "@/components/AgentAvatar";
import { TextDiff } from "@/components/TextDiff";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useApp } from "@/context/app-ctx";
import type { Capture } from "@/data/types";
import { CaptureReview } from "./CaptureReview";
import { estimatePrecheck, proposedCommunity } from "./precheck";
import { PrecheckList } from "./PrecheckList";
import { ProposalFields } from "./ProposalFields";
import type { PreviewState } from "./usePreviews";

interface ProposalCardProps {
  capture: Capture;
  preview: PreviewState | undefined;
  /** Stored proposal with Sentinel's pre-check (gap 11), when available. */
  proposal: CaptureProposal | undefined;
  onRetry: () => void;
  onMerged: () => void;
  onSeparate: () => void;
}

/** A demo seed suggestion as a preview, so both render the same way. */
function asPreview(
  capture: Capture,
  noteTitle: (id: string) => string | undefined,
): CapturePreview | null {
  const s = capture.suggestion;
  if (!s) return null;
  return {
    note_type: s.type,
    folder: s.destFolder,
    title: s.title,
    tags: s.tags,
    body: capture.body,
    links: s.links.map((id) => ({
      note_id: id,
      title: noteTitle(id) ?? id,
      score: 1,
      decision: "auto-linked",
    })),
  };
}

/** Weaver's proposal: where it files, its frontmatter, links and checks. */
export function ProposalCard(p: ProposalCardProps) {
  const { notes, noteById, communities } = useApp();
  const [duplicates, setDuplicates] = useState<DuplicateEvidence[]>([]);
  const demo = asPreview(p.capture, (id) => noteById(id)?.title);
  const preview =
    demo ?? (p.preview?.status === "ready" ? p.preview.preview : null);

  const header = (
    <header className="flex items-center gap-2 text-sm font-medium text-foreground">
      <AgentAvatar actor="weaver" size="md" />
      Weaver's proposal
    </header>
  );
  if (!preview) {
    const failed = p.preview?.status === "error" ? p.preview.message : null;
    return (
      <section
        aria-label="Weaver's proposal"
        className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
      >
        {header}
        {failed ? (
          <div role="status" className="flex items-center gap-3 text-sm">
            <span className="flex-1 text-danger-foreground">{failed}</span>
            <Button size="sm" variant="outline" onClick={p.onRetry}>
              <RotateCcw aria-hidden="true" />
              Retry
            </Button>
          </div>
        ) : (
          <p
            role="status"
            className="flex items-center gap-2 text-sm text-muted-foreground"
          >
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            Weaver is reading this capture…
          </p>
        )}
      </section>
    );
  }

  const slot = proposedCommunity(
    preview.links.map((l) => l.note_id).filter(Boolean),
    communities.slotOf,
  );
  const community =
    slot === null
      ? undefined
      : communities.communities.find((c) => c.slot === slot);
  const checks = p.proposal?.precheck.length
    ? p.proposal.precheck
    : estimatePrecheck(preview, notes, duplicates);
  return (
    <section
      aria-label="Weaver's proposal"
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4"
    >
      {header}
      <ProposalFields preview={preview} community={community} />
      {!demo && (
        <CaptureReview
          capture={p.capture}
          proposedBody={preview.body}
          onMerged={p.onMerged}
          onSeparate={p.onSeparate}
          onDuplicates={setDuplicates}
        />
      )}
      <PrecheckList items={checks} estimated={!p.proposal?.precheck.length} />
      {!demo && preview.body !== p.capture.body && (
        <Collapsible className="group/diff flex flex-col gap-2">
          <CollapsibleTrigger className="flex items-center gap-1 self-start rounded-sm text-xs text-secondary-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            <ChevronRight
              aria-hidden="true"
              className="size-3.5 transition-transform group-data-[state=open]/diff:rotate-90"
            />
            Compare with the capture
          </CollapsibleTrigger>
          <CollapsibleContent>
            <TextDiff before={p.capture.body} after={preview.body} />
          </CollapsibleContent>
        </Collapsible>
      )}
    </section>
  );
}
