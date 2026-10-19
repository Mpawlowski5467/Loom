import type { CouncilMessage } from "@/data/types";
import { AgentMessage } from "./AgentMessage";
import { CouncilText } from "./councilText";
import { SummaryCard } from "./SummaryCard";

interface CouncilThreadProps {
  messages: readonly CouncilMessage[];
  onRawCall: (traceId: string) => void;
}

/** You on the right; agents on the left; each reply ends in a summary. */
export function CouncilThread({ messages, onRawCall }: CouncilThreadProps) {
  if (messages.length === 0)
    return (
      <p className="m-auto max-w-60 text-center text-sm text-muted-foreground">
        Ask the Council about your vault. Each Loom agent answers, then their
        answers are summarized.
      </p>
    );
  return (
    <ol className="flex flex-col gap-4">
      {messages.map((m) => (
        <li key={m.id} className="flex flex-col gap-3">
          {m.who === "you" ? (
            <p className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-brand px-3 py-2 text-sm whitespace-pre-wrap text-brand-foreground">
              <span className="sr-only">You: </span>
              <CouncilText text={m.body} />
            </p>
          ) : m.who === "summary" ? (
            <SummaryCard message={m} onRawCall={onRawCall} />
          ) : m.who === "agent:council" ? (
            <>
              {m.contributions?.map((c, i) => (
                <AgentMessage
                  key={`${c.agent}-${i}`}
                  agent={c.agent}
                  body={c.body}
                  error={c.error}
                  traceId={c.traceId}
                  clamp
                  onRawCall={onRawCall}
                />
              ))}
              <SummaryCard message={m} onRawCall={onRawCall} />
            </>
          ) : (
            <AgentMessage
              agent={m.who.slice("agent:".length)}
              body={m.body}
              traceId={m.traceId}
              onRawCall={onRawCall}
            />
          )}
        </li>
      ))}
    </ol>
  );
}
