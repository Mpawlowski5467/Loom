import { useCallback, useEffect, useRef, useState } from "react";
import { loadChatHistory, streamCouncilMessage } from "../api/chat";
import type { CouncilMessage, CouncilWho } from "../data/types";

/** Own persisted history and the cancellable Council SSE conversation. */
export function useCouncil(
  demo: boolean,
  seed: CouncilMessage[],
): {
  council: CouncilMessage[];
  postCouncilMessage: (body: string) => Promise<void>;
} {
  const [council, setCouncil] = useState<CouncilMessage[]>(demo ? seed : []);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    void loadChatHistory("_council", 50)
      .then((response) => {
        if (cancelled || response.messages.length === 0) return;
        setCouncil(
          response.messages.map((message, index) => ({
            id: `cm_hist_${index}_${message.timestamp}`,
            who:
              message.role === "user" ? "you" : ("agent:council" as CouncilWho),
            body: message.content,
            at: message.timestamp,
          })),
        );
      })
      .catch(() => {
        // Persisted history is best-effort; an empty conversation is safe.
      });
    return () => {
      cancelled = true;
    };
  }, [demo]);

  const postCouncilMessage = useCallback(async (body: string) => {
    if (!body.trim()) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const now = Date.now();
    const replyId = `cm_${now}_reply`;
    setCouncil((previous) => [
      ...previous,
      {
        id: `cm_${now}`,
        who: "you",
        body,
        at: new Date().toISOString(),
      },
      {
        id: replyId,
        who: "agent:council" as CouncilWho,
        body: "",
        at: new Date().toISOString(),
        pending: true,
      },
    ]);

    const updateReply = (
      patch:
        | Partial<CouncilMessage>
        | ((message: CouncilMessage) => Partial<CouncilMessage>),
    ) => {
      setCouncil((previous) =>
        previous.map((message) =>
          message.id === replyId
            ? {
                ...message,
                ...(typeof patch === "function" ? patch(message) : patch),
              }
            : message,
        ),
      );
    };

    try {
      await streamCouncilMessage(body, {
        signal: controller.signal,
        onEvent: (event) => {
          if (event.kind === "contributions") {
            const contributions = event.contributions
              .filter(
                (contribution) =>
                  contribution.content.trim().length > 0 || contribution.error,
              )
              .map((contribution) => ({
                agent: contribution.agent,
                body: contribution.content,
                traceId: contribution.trace_id || undefined,
                error: contribution.error || undefined,
              }));
            updateReply({
              contributions:
                contributions.length > 0 ? contributions : undefined,
            });
          } else if (event.kind === "token") {
            updateReply((message) => ({
              body: message.body + event.chunk,
            }));
          } else if (event.kind === "done") {
            const contributions = event.contributions
              .filter(
                (contribution) =>
                  contribution.content.trim().length > 0 || contribution.error,
              )
              .map((contribution) => ({
                agent: contribution.agent,
                body: contribution.content,
                traceId: contribution.trace_id || undefined,
                error: contribution.error || undefined,
              }));
            updateReply({
              body: event.assistantText,
              traceId: event.traceId || undefined,
              contributions:
                contributions.length > 0 ? contributions : undefined,
              pending: false,
              at: new Date().toISOString(),
            });
          } else if (event.kind === "error") {
            updateReply({ body: `⚠ ${event.message}`, pending: false });
          }
        },
      });
      updateReply((message) => (message.pending ? { pending: false } : {}));
    } catch (error) {
      if ((error as DOMException)?.name === "AbortError") {
        updateReply((message) =>
          message.body.trim().length > 0
            ? { pending: false }
            : { pending: false, body: "⚠ Cancelled" },
        );
        return;
      }
      updateReply({
        body: `⚠ Failed: ${error instanceof Error ? error.message : String(error)}`,
        pending: false,
      });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, []);

  return { council, postCouncilMessage };
}
