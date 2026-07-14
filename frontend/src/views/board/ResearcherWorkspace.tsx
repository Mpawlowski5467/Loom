import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { BookOpen, Check, Inbox, Loader2, Search, X } from "lucide-react";
import { loadChatHistory } from "../../api/chat";
import { createCapture } from "../../api/captures";
import {
  queryResearcher,
  type ResearcherReference,
} from "../../api/researcher";
import { useFocusTrap } from "../../components/useFocusTrap";
import { AgentBlob } from "../../components/primitives/AgentBlob";
import { Markdown } from "../../editor/Markdown";
import { useApp } from "../../context/app-ctx";

interface ResearcherWorkspaceProps {
  onClose: () => void;
}

interface ResearchTurn {
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
        .map(
          (source) =>
            `- [[${source.title}]]${source.heading ? ` — ${source.heading}` : ""}`,
        )
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

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function SourceCards({
  sources,
}: {
  sources: ResearcherReference[];
}): ReactNode {
  const { openNote } = useApp();

  if (sources.length === 0) {
    return (
      <div className="researcher-no-sources">
        No vault sources were returned for this answer.
      </div>
    );
  }

  return (
    <section
      className="researcher-sources"
      aria-label={`${sources.length} vault source${sources.length === 1 ? "" : "s"}`}
    >
      <div className="researcher-sources-label">
        Vault sources · {sources.length}
      </div>
      <div className="researcher-source-grid">
        {sources.map((source) => (
          <button
            key={`${source.note_id}:${source.heading ?? ""}`}
            type="button"
            className="researcher-source-card"
            onClick={() => openNote(source.note_id)}
            aria-label={`Open source ${source.title}`}
            title={source.path || source.title}
          >
            <BookOpen size={15} aria-hidden="true" />
            <span className="researcher-source-copy">
              <strong>{source.title}</strong>
              <span>
                {[source.type, source.heading].filter(Boolean).join(" · ") ||
                  "vault note"}
              </span>
              {source.snippet && <small>{source.snippet}</small>}
            </span>
            {typeof source.score === "number" &&
              Number.isFinite(source.score) && (
                <span className="researcher-source-score">
                  {Math.round(Math.min(1, Math.max(0, source.score)) * 100)}%
                </span>
              )}
          </button>
        ))}
      </div>
    </section>
  );
}

export function ResearcherWorkspace({
  onClose,
}: ResearcherWorkspaceProps): ReactNode {
  const { pushToast } = useApp();
  const [turns, setTurns] = useState<ResearchTurn[]>([]);
  const [question, setQuestion] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [asking, setAsking] = useState(false);
  const [savingTurnId, setSavingTurnId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const turnSequence = useRef(0);
  const requestAbort = useRef<AbortController | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>({ onEscape: onClose });

  const nextTurnId = (prefix: string) => {
    turnSequence.current += 1;
    return `${prefix}-${turnSequence.current}`;
  };

  useEffect(() => {
    let cancelled = false;
    loadChatHistory("researcher", 40)
      .then((history) => {
        if (cancelled) return;
        const historicTurns: ResearchTurn[] = history.messages
          .filter(
            (message) =>
              message.role === "user" || message.role === "assistant",
          )
          .map((message, index) => ({
            id: `history-${index}`,
            role: message.role as ResearchTurn["role"],
            content: message.content,
            timestamp: message.timestamp,
          }));
        // Preserve a question submitted before the history request finished.
        setTurns((current) => [...historicTurns, ...current]);
      })
      .catch(() => {
        // History is a convenience; a failed history read must not block a new query.
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });

    return () => {
      cancelled = true;
      requestAbort.current?.abort();
    };
  }, []);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [turns, asking]);

  const ask = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || asking || savingTurnId) return;

    const askedAt = new Date().toISOString();
    setTurns((current) => [
      ...current,
      {
        id: nextTurnId("question"),
        role: "user",
        content: trimmed,
        timestamp: askedAt,
      },
    ]);
    setQuestion("");
    setError(null);
    setAsking(true);
    const controller = new AbortController();
    requestAbort.current = controller;

    try {
      const result = await queryResearcher(trimmed, {
        saveCapture: false,
        persistChat: true,
        signal: controller.signal,
      });
      const answerId = nextTurnId("answer");
      setTurns((current) => [
        ...current,
        {
          id: answerId,
          role: "assistant",
          content: result.answer,
          timestamp: new Date().toISOString(),
          question: trimmed,
          sources: result.referenced_notes,
          savedToInbox: result.saved_to_inbox,
          captureId: result.capture_id,
          capturePath: result.capture_path,
          saveKey: `researcher-workspace:${askedAt}:${answerId}`,
        },
      ]);
    } catch (caught) {
      if ((caught as DOMException)?.name !== "AbortError") {
        setError(
          caught instanceof Error
            ? caught.message
            : "Researcher could not answer",
        );
        setQuestion(trimmed);
      }
    } finally {
      if (requestAbort.current === controller) requestAbort.current = null;
      setAsking(false);
    }
  };

  const saveToInbox = async (turn: ResearchTurn) => {
    if (!turn.question || turn.savedToInbox || asking || savingTurnId) return;
    setError(null);
    setSavingTurnId(turn.id);
    const controller = new AbortController();
    requestAbort.current = controller;

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
        controller.signal,
      );
      setTurns((current) =>
        current.map((item) =>
          item.id === turn.id
            ? {
                ...item,
                savedToInbox: true,
                captureId: saved.capture.id,
                capturePath: saved.capture.file_path,
              }
            : item,
        ),
      );
      pushToast({
        icon: "📥",
        agent: "researcher",
        body: "Research saved to Inbox for Loom review",
      });
    } catch (caught) {
      if ((caught as DOMException)?.name !== "AbortError") {
        setError(
          caught instanceof Error ? caught.message : "Could not save to Inbox",
        );
      }
    } finally {
      if (requestAbort.current === controller) requestAbort.current = null;
      setSavingTurnId(null);
    }
  };

  const busy = asking || savingTurnId !== null;

  return (
    <div
      className="settings-modal-backdrop researcher-workspace-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="settings-modal researcher-workspace"
        role="dialog"
        aria-modal="true"
        aria-labelledby="researcher-workspace-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="researcher-workspace-head">
          <AgentBlob
            agent="researcher"
            state={asking ? "running" : "idle"}
            size={40}
          />
          <div>
            <h2 id="researcher-workspace-title">Researcher</h2>
            <p>
              Ask your vault, inspect the evidence, then decide what to keep.
            </p>
          </div>
          <button
            type="button"
            className="icon-btn researcher-workspace-close"
            onClick={onClose}
            aria-label="Close Researcher workspace"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="researcher-save-note">
          <Inbox size={14} aria-hidden="true" />
          Preview only — nothing is added to Inbox until you choose Save to
          Inbox.
        </div>

        <div
          ref={threadRef}
          className="researcher-thread"
          aria-live="polite"
          aria-busy={asking}
        >
          {loadingHistory && turns.length === 0 && (
            <div className="researcher-thread-state" role="status">
              <Loader2 size={15} className="spin" aria-hidden="true" />
              Loading Researcher history…
            </div>
          )}
          {!loadingHistory && turns.length === 0 && (
            <div className="researcher-welcome">
              <Search size={22} aria-hidden="true" />
              <strong>What do you want to understand?</strong>
              <span>
                Researcher searches your notes and attaches the passages used to
                answer.
              </span>
            </div>
          )}
          {turns.map((turn) => (
            <article
              key={turn.id}
              className={`researcher-turn researcher-turn--${turn.role}`}
            >
              <div className="researcher-turn-meta">
                <span>{turn.role === "user" ? "You" : "Researcher"}</span>
                <time dateTime={turn.timestamp}>
                  {formatTime(turn.timestamp)}
                </time>
              </div>
              {turn.role === "assistant" ? (
                <>
                  <Markdown
                    source={
                      turn.content || "Researcher returned an empty answer."
                    }
                    bodyClass="researcher-answer"
                  />
                  {turn.sources !== undefined && (
                    <SourceCards sources={turn.sources} />
                  )}
                  {turn.question && (
                    <div className="researcher-answer-actions">
                      {turn.savedToInbox ? (
                        <span className="researcher-saved" role="status">
                          <Check size={14} aria-hidden="true" />
                          Saved to Inbox
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-md btn-purple"
                          onClick={() => void saveToInbox(turn)}
                          disabled={busy}
                          aria-label="Save this research to Inbox"
                        >
                          {savingTurnId === turn.id ? (
                            <Loader2
                              size={14}
                              className="spin"
                              aria-hidden="true"
                            />
                          ) : (
                            <Inbox size={14} aria-hidden="true" />
                          )}
                          Save to Inbox
                        </button>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <p className="researcher-question">{turn.content}</p>
              )}
            </article>
          ))}
          {asking && (
            <div className="researcher-thinking" role="status">
              <Loader2 size={15} className="spin" aria-hidden="true" />
              Searching notes and checking evidence…
            </div>
          )}
        </div>

        <div className="researcher-composer-wrap">
          {error && (
            <div className="researcher-error" role="alert">
              {error}
            </div>
          )}
          <form
            className="researcher-composer"
            onSubmit={(event) => void ask(event)}
          >
            <label htmlFor="researcher-question" className="sr-only">
              Question for Researcher
            </label>
            <textarea
              id="researcher-question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Ask a question about your vault…"
              rows={3}
              disabled={busy}
              autoFocus
            />
            <div className="researcher-composer-actions">
              <span>⌘/Ctrl + Enter to ask</span>
              <button
                type="submit"
                className="btn btn-md btn-active"
                disabled={busy || question.trim().length === 0}
              >
                {asking ? (
                  <Loader2 size={14} className="spin" aria-hidden="true" />
                ) : (
                  <Search size={14} aria-hidden="true" />
                )}
                Ask Researcher
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
