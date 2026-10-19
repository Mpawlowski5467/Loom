import { useEffect, useRef, useState } from "react";
import { createCapture } from "@/api/captures";
import { loadChatHistory } from "@/api/chat";
import { queryResearcher, type ResearcherReference } from "@/api/researcher";
import { useApp } from "@/context/app-ctx";

export interface ResearchTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  /** Present only for answers previewed in this workspace. */
  question?: string;
  sources?: ResearcherReference[];
  savedToInbox?: boolean;
  captureId?: string;
  capturePath?: string;
  /** Stable idempotency key used if saving is retried after a network loss. */
  saveKey?: string;
}

function captureBody(turn: ResearchTurn): string {
  const sources = turn.sources?.length
    ? turn.sources
        .map((s) => `- [[${s.title}]]${s.heading ? ` — ${s.heading}` : ""}`)
        .join("\n")
    : "None";
  return [
    "## Question",
    turn.question ?? "",
    "## Answer",
    turn.content,
    "## Sources",
    sources,
  ].join("\n\n");
}

const errorText = (caught: unknown, fallback: string) =>
  caught instanceof Error ? caught.message : fallback;
const aborted = (caught: unknown) =>
  (caught as DOMException)?.name === "AbortError";

/**
 * The Researcher conversation: persisted history, asking (preview only), and
 * saving an answer to the Inbox as an idempotent capture.
 */
export function useResearcher() {
  const { pushToast } = useApp();
  const [turns, setTurns] = useState<ResearchTurn[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [asking, setAsking] = useState(false);
  const [savingTurnId, setSavingTurnId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const nextId = (prefix: string) => `${prefix}-${++seq.current}`;

  useEffect(() => {
    let cancelled = false;
    loadChatHistory("researcher", 40)
      .then((history) => {
        if (cancelled) return;
        const past: ResearchTurn[] = history.messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m, i) => ({
            id: `history-${i}`,
            role: m.role as ResearchTurn["role"],
            content: m.content,
            timestamp: m.timestamp,
          }));
        // Keep a question asked before the history arrived.
        setTurns((current) => [...past, ...current]);
      })
      .catch(() => {
        // History is a convenience; a failed read must not block a new query.
      })
      .finally(() => !cancelled && setLoadingHistory(false));
    return () => {
      cancelled = true;
      abort.current?.abort();
    };
  }, []);

  const ask = async (question: string): Promise<boolean> => {
    const trimmed = question.trim();
    if (!trimmed || asking || savingTurnId) return false;
    const askedAt = new Date().toISOString();
    setTurns((c) => [
      ...c,
      {
        id: nextId("question"),
        role: "user",
        content: trimmed,
        timestamp: askedAt,
      },
    ]);
    setError(null);
    setAsking(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const r = await queryResearcher(trimmed, {
        saveCapture: false,
        persistChat: true,
        signal: ctrl.signal,
      });
      const id = nextId("answer");
      setTurns((c) => [
        ...c,
        {
          id,
          role: "assistant",
          content: r.answer,
          timestamp: new Date().toISOString(),
          question: trimmed,
          sources: r.referenced_notes,
          savedToInbox: r.saved_to_inbox,
          captureId: r.capture_id,
          capturePath: r.capture_path,
          saveKey: `researcher-workspace:${askedAt}:${id}`,
        },
      ]);
      return true;
    } catch (caught) {
      if (!aborted(caught))
        setError(errorText(caught, "Researcher could not answer"));
      return false;
    } finally {
      if (abort.current === ctrl) abort.current = null;
      setAsking(false);
    }
  };

  const save = async (turn: ResearchTurn) => {
    if (!turn.question || turn.savedToInbox || asking || savingTurnId) return;
    setError(null);
    setSavingTurnId(turn.id);
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const saved = await createCapture(
        {
          title: `Research: ${turn.question.slice(0, 120)}`,
          body: captureBody(turn),
          source: "agent:researcher",
          tags: ["research"],
          external_id: turn.saveKey ?? `researcher-workspace:${turn.id}`,
          provenance: {
            workspace: "researcher",
            question: turn.question,
            source_count: turn.sources?.length ?? 0,
          },
        },
        ctrl.signal,
      );
      setTurns((c) =>
        c.map((t) =>
          t.id === turn.id
            ? {
                ...t,
                savedToInbox: true,
                captureId: saved.capture.id,
                capturePath: saved.capture.file_path,
              }
            : t,
        ),
      );
      pushToast({
        icon: "✓",
        agent: "researcher",
        body: "Research saved to Inbox for Loom review",
      });
    } catch (caught) {
      if (!aborted(caught))
        setError(errorText(caught, "Could not save to Inbox"));
    } finally {
      if (abort.current === ctrl) abort.current = null;
      setSavingTurnId(null);
    }
  };

  return { turns, loadingHistory, asking, savingTurnId, error, ask, save };
}
