import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useApp } from "../../context/app-ctx";
import { AgentBlob } from "../../components/primitives/AgentBlob";
import { TraceModal } from "../../components/TraceModal";
import { askAgent } from "../../api/agentsRegistry";
import { liveAgentState } from "./boardHelpers";

interface SeatReply {
  status: "idle" | "thinking" | "done" | "error";
  text: string;
  traceId?: string;
}

/** Fires one question at every Loom agent in parallel and seats their replies
 * around a table. Opened as a modal from the Board toolbar. */
export function RoundTableModal({ onClose }: { onClose: () => void }): ReactNode {
  const { agents, agentActivity } = useApp();
  const loomAgents = agents.filter((a) => a.layer === "loom");

  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState("");
  const [replies, setReplies] = useState<Record<string, SeatReply>>({});
  const [openTraceId, setOpenTraceId] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !openTraceId) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, openTraceId]);

  const askAll = async () => {
    const q = question.trim();
    if (!q) return;
    setAsked(q);
    setQuestion("");
    setReplies(
      Object.fromEntries(
        loomAgents.map((a) => [a.id, { status: "thinking", text: "" }]),
      ),
    );
    await Promise.allSettled(
      loomAgents.map(async (a) => {
        try {
          const res = await askAgent(a.id, q);
          setReplies((prev) => ({
            ...prev,
            [a.id]: {
              status: res.error ? "error" : "done",
              text: res.error || res.reply,
              traceId: res.trace_id || undefined,
            },
          }));
        } catch (err) {
          setReplies((prev) => ({
            ...prev,
            [a.id]: {
              status: "error",
              text: err instanceof Error ? err.message : "request failed",
            },
          }));
        }
      }),
    );
  };

  return (
    <div className="board-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="board-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Round table"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="board-modal-h">
          <div>
            <div className="settings-kicker">Loom Council</div>
            <h2 className="settings-modal-title">Round table</h2>
          </div>
          <button
            type="button"
            className="board-modal-close"
            onClick={onClose}
            aria-label="Close round table"
          >
            ✕
          </button>
        </div>

        {loomAgents.length === 0 ? (
          <div className="board-empty">No Loom agents available to convene.</div>
        ) : (
          <div className="round-table-mode">
            <div className="rt-stage">
              <div className="rt-table" />
              <div className="rt-question">
                <div className="label">ask the round table</div>
                {asked && <div className="q">{asked}</div>}
                <div className="rt-ask-row">
                  <input
                    type="text"
                    className="input"
                    placeholder="what should the agents weigh in on?"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void askAll();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-md btn-active"
                    onClick={() => void askAll()}
                    disabled={!question.trim()}
                  >
                    ask
                  </button>
                </div>
              </div>
              {loomAgents.map((a, i) => {
                const theta = (i / loomAgents.length) * Math.PI * 2 - Math.PI / 2;
                const left = 50 + Math.cos(theta) * 38;
                const top = 50 + Math.sin(theta) * 30;
                const reply = replies[a.id];
                const live = agentActivity[a.name.toLowerCase()];
                const isThinking = reply?.status === "thinking";
                const blobState =
                  isThinking ? "running" : liveAgentState(a, live);

                let bubble: string;
                if (isThinking) bubble = "…thinking";
                else if (reply?.status === "done") bubble = reply.text;
                else if (reply?.status === "error") bubble = `⚠ ${reply.text}`;
                else bubble = "(waiting for question)";

                return (
                  <div
                    key={a.id}
                    className="rt-seat"
                    style={{ left: `${left}%`, top: `${top}%` }}
                  >
                    <div
                      className="rt-icon"
                      style={{ animationDelay: `${-i * 0.5}s` }}
                      aria-hidden="true"
                    >
                      <AgentBlob agent={a.id} state={blobState} size={52} />
                    </div>
                    <div className="rt-name">
                      {a.name}
                      {reply?.traceId && (
                        <button
                          type="button"
                          className="rt-raw-btn"
                          onClick={() => setOpenTraceId(reply.traceId!)}
                          title="View raw LLM call"
                        >
                          raw
                        </button>
                      )}
                    </div>
                    <div
                      className={`rt-bubble ${reply?.status ?? "empty"}`}
                      data-empty={!reply}
                    >
                      {bubble}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      {openTraceId && (
        <TraceModal traceId={openTraceId} onClose={() => setOpenTraceId(null)} />
      )}
    </div>
  );
}
