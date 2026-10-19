import { Inbox, Loader2, Search } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AgentAvatar } from "@/components/AgentAvatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ResearchTurnView } from "./researcher/ResearchTurnView";
import { useResearcher } from "./researcher/useResearcher";

/** Ask the vault, inspect the evidence, then decide what to keep. */
export function ResearcherWorkspace({ onClose }: { onClose: () => void }) {
  const r = useResearcher();
  const [question, setQuestion] = useState("");
  const threadRef = useRef<HTMLDivElement | null>(null);
  const busy = r.asking || r.savingTurnId !== null;

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [r.turns, r.asking]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const q = question;
    if (!q.trim() || busy) return;
    setQuestion("");
    if (!(await r.ask(q))) setQuestion(q);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(760px,90vh)] flex-col gap-0 p-0 sm:max-w-3xl"
      >
        <header className="flex items-center gap-3 border-b border-border px-5 py-4">
          <AgentAvatar actor="researcher" size="lg" />
          <div className="min-w-0 flex-1">
            <DialogTitle>Researcher</DialogTitle>
            <DialogDescription>
              Ask your vault, inspect the evidence, then decide what to keep.
            </DialogDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Close Researcher workspace"
          >
            Close
          </Button>
        </header>
        <p className="flex items-center gap-2 border-b border-border bg-muted px-5 py-2 text-xs text-muted-foreground">
          <Inbox aria-hidden="true" className="size-3.5" />
          Preview only: nothing is added to the Inbox until you choose Save to
          Inbox.
        </p>
        <div
          ref={threadRef}
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4"
          aria-live="polite"
          aria-busy={r.asking}
        >
          {r.loadingHistory && r.turns.length === 0 && (
            <p
              role="status"
              className="flex items-center gap-2 text-sm text-muted-foreground"
            >
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              Loading Researcher history…
            </p>
          )}
          {!r.loadingHistory && r.turns.length === 0 && (
            <div className="m-auto flex max-w-sm flex-col items-center gap-2 text-center">
              <Search
                aria-hidden="true"
                className="size-6 text-muted-foreground"
              />
              <strong className="text-sm font-medium text-foreground">
                What do you want to understand?
              </strong>
              <span className="text-sm text-muted-foreground">
                Researcher searches your notes and attaches the passages it
                used.
              </span>
            </div>
          )}
          {r.turns.map((turn) => (
            <ResearchTurnView
              key={turn.id}
              turn={turn}
              busy={busy}
              saving={r.savingTurnId === turn.id}
              onSave={() => void r.save(turn)}
            />
          ))}
          {r.asking && (
            <p
              role="status"
              className="flex items-center gap-2 text-sm text-muted-foreground"
            >
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              Searching notes and checking evidence…
            </p>
          )}
        </div>
        <form
          className="flex flex-col gap-2 border-t border-border px-5 py-3"
          onSubmit={(e) => void submit(e)}
        >
          {r.error && (
            <p role="alert" className="text-sm text-danger-foreground">
              {r.error}
            </p>
          )}
          <Textarea
            aria-label="Question for Researcher"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Ask a question about your vault…"
            rows={3}
            disabled={busy}
            autoFocus
            className="resize-none"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              ⌘/Ctrl + Enter to ask
            </span>
            <Button
              type="submit"
              size="sm"
              disabled={busy || question.trim().length === 0}
            >
              {r.asking ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : (
                <Search aria-hidden="true" />
              )}
              Ask Researcher
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
