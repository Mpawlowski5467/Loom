import { ArrowUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AgentAvatar } from "@/components/AgentAvatar";
import { TraceModal } from "@/components/TraceModal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useApp } from "@/context/app-ctx";
import { COUNCIL_AGENTS } from "./councilAgents";
import { CouncilThread } from "./CouncilThread";

/** The Loom Council: ask once, every Loom agent answers, one summary. */
export function CouncilPanel() {
  const { council, postCouncilMessage, councilPrefill, setCouncilPrefill } =
    useApp();
  const [text, setText] = useState(councilPrefill ?? "");
  const [taken, setTaken] = useState<string | null>(councilPrefill);
  // "Ask Council" from a note or the palette prefills the composer.
  if (councilPrefill !== taken) {
    setTaken(councilPrefill);
    if (councilPrefill !== null) setText(councilPrefill);
  }
  useEffect(() => {
    if (councilPrefill !== null) setCouncilPrefill(null);
  }, [councilPrefill, setCouncilPrefill]);

  const [trace, setTrace] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const last = council[council.length - 1];
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [council.length, last?.body, last?.contributions?.length]);

  // One turn at a time: a second send would fan out another ~6 calls.
  const streaming = last?.pending === true;
  const send = () => {
    if (!text.trim() || streaming) return;
    void postCouncilMessage(text.trim());
    setText("");
  };

  return (
    <aside
      aria-label="Loom Council"
      className="flex min-h-0 w-full flex-col bg-sidebar"
    >
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <div className="flex -space-x-1.5" aria-hidden="true">
          {COUNCIL_AGENTS.map((a) => (
            <AgentAvatar
              key={a}
              actor={a}
              size="md"
              className="ring-2 ring-sidebar"
            />
          ))}
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-foreground">Council</h2>
          <p className="truncate text-xs text-muted-foreground">
            Weaver · Spider · Archivist · Scribe · Sentinel
          </p>
        </div>
      </header>
      <div
        ref={logRef}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4"
        aria-live="polite"
      >
        <CouncilThread messages={council} onRawCall={setTrace} />
      </div>
      <form
        className="flex items-end gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <Textarea
          aria-label="Ask the Loom Council"
          placeholder={
            streaming ? "The Council is answering…" : "Ask the Council…"
          }
          value={text}
          rows={2}
          disabled={streaming}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          className="max-h-40 min-h-10 resize-none bg-background text-sm"
        />
        <Button
          type="submit"
          size="icon"
          aria-label="Send to the Council"
          disabled={streaming || !text.trim()}
        >
          <ArrowUp aria-hidden="true" />
        </Button>
      </form>
      {trace && <TraceModal traceId={trace} onClose={() => setTrace(null)} />}
    </aside>
  );
}
