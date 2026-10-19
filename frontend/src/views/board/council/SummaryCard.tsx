import { FileDiff, Sparkles, Undo2 } from "lucide-react";
import { useState } from "react";
import { revertCommit } from "@/api/history";
import { CommitDetail } from "@/components/CommitDetail";
import { ConfirmModal } from "@/components/ConfirmModal";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { CouncilMessage } from "@/data/types";
import { CouncilText } from "./councilText";

interface SummaryCardProps {
  message: CouncilMessage;
  onRawCall: (traceId: string) => void;
}

/**
 * The Council's consolidated answer. Open diff and Undo appear only when the
 * reply made vault changes (gap 10: the Council doesn't write yet).
 */
export function SummaryCard({ message, onRawCall }: SummaryCardProps) {
  const [diff, setDiff] = useState<string | null>(null);
  const [undo, setUndo] = useState<string | null>(null);
  const [undone, setUndone] = useState<ReadonlySet<string>>(new Set());
  const thinking = message.pending && !message.body;
  return (
    <section
      aria-label="Council summary"
      className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3"
    >
      <header className="flex items-center gap-1.5 text-xs font-medium text-foreground">
        <Sparkles aria-hidden="true" className="size-3.5 text-brand" />
        Summary
        {message.traceId && (
          <Button
            variant="link"
            size="xs"
            className="ml-auto h-auto p-0 text-[11px] text-muted-foreground"
            onClick={() => onRawCall(message.traceId!)}
            aria-label="View the summary's raw LLM call"
          >
            Raw call
          </Button>
        )}
      </header>
      <p
        className="text-sm leading-relaxed whitespace-pre-wrap text-secondary-foreground"
        aria-busy={message.pending}
      >
        {thinking ? (
          <span className="text-muted-foreground">
            The Council is discussing…
          </span>
        ) : (
          <CouncilText text={message.body} />
        )}
      </p>
      {message.commits?.map((c) => (
        <div
          key={c.sha}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2 text-xs"
        >
          <span
            className="min-w-0 flex-1 truncate font-mono text-muted-foreground"
            title={c.subject}
          >
            {c.sha.slice(0, 7)} {c.subject}
          </span>
          <Button
            variant="link"
            size="xs"
            className="h-auto p-0"
            onClick={() => setDiff(c.sha)}
          >
            <FileDiff aria-hidden="true" />
            Open diff
          </Button>
          {undone.has(c.sha) ? (
            <span className="text-muted-foreground">Undone</span>
          ) : (
            <Button
              variant="link"
              size="xs"
              className="h-auto p-0"
              onClick={() => setUndo(c.sha)}
            >
              <Undo2 aria-hidden="true" />
              Undo
            </Button>
          )}
        </div>
      ))}
      {diff && (
        <Dialog open onOpenChange={(open) => !open && setDiff(null)}>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
            <DialogTitle>Council change</DialogTitle>
            <CommitDetail sha={diff} />
          </DialogContent>
        </Dialog>
      )}
      {undo && (
        <ConfirmModal
          title="Undo the Council's change?"
          body="Loom adds a commit that reverses it; nothing is erased from history. Sentinel checks the result first."
          confirmLabel="Undo change"
          destructive={false}
          onClose={() => setUndo(null)}
          onConfirm={async () => {
            await revertCommit(undo);
            setUndone((prev) => new Set(prev).add(undo));
          }}
        />
      )}
    </section>
  );
}
