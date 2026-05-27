import { useState } from "react";
import type { ReactNode } from "react";
import { useApp } from "../../context/app-ctx";
import { AgentBlob } from "../../components/primitives/AgentBlob";
import { TraceModal } from "../../components/TraceModal";
import { askAgent } from "../../api/agentsRegistry";

interface SeatReply {
  status: "idle" | "thinking" | "done" | "error";
  text: string;
  traceId?: string;
}

export function RoundTableMode(): ReactNode {
  const { agents, agentActivity } = useApp();
  const loomAgents = agents.filter((a) => a.layer === "loom");

  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState("");
  const [replies, setReplies] = useState<Record<string, SeatReply>>({});
  const [openTraceId, setOpenTraceId] = useState<string | null>(null);

  const askAll = async () => {
    const q = question.trim();
    if (!q) return;
    setAsked(q);
    setQuestion("");
    // Seed every Loom seat as "thinking"
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
    <div className="round-table-mode">
      <div className="rt-stage">
        <div className="rt-table" />
        <div
          className="rt-question"
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          <div className="label">ask the round table</div>
          {asked && <div className="q">{asked}</div>}
          <div
            style={{
              display: "flex",
              gap: 6,
              alignItems: "center",
              pointerEvents: "auto",
              width: "min(420px, 70%)",
            }}
          >
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
              style={{
                flex: 1,
                fontSize: 12,
                padding: "4px 8px",
                borderRadius: 4,
                border: "1px solid rgba(26,24,21,0.15)",
                background: "var(--bg-surface)",
                color: "var(--ink)",
                fontFamily: "var(--sans, Inter, system-ui)",
              }}
            />
            <button
              type="button"
              onClick={() => void askAll()}
              disabled={!question.trim()}
              style={{
                fontSize: 11,
                padding: "4px 10px",
                borderRadius: 4,
                border: "1px solid rgba(26,24,21,0.2)",
                background: question.trim() ? "var(--agent)" : "var(--bg-elevated)",
                color: question.trim() ? "white" : "var(--ink-3)",
                cursor: question.trim() ? "pointer" : "not-allowed",
                fontFamily: "var(--sans)",
              }}
            >
              ask
            </button>
          </div>
        </div>
        {loomAgents.map((a, i) => {
          const theta =
            (i / loomAgents.length) * Math.PI * 2 - Math.PI / 2;
          const rx = 38;
          const ry = 30;
          const left = 50 + Math.cos(theta) * rx;
          const top = 50 + Math.sin(theta) * ry;
          const reply = replies[a.id];
          const live = agentActivity[a.name.toLowerCase()];
          const isThinking = reply?.status === "thinking";
          const blobState =
            isThinking || live?.state === "running" ? "running" : a.state;

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
                    onClick={() => setOpenTraceId(reply.traceId!)}
                    title="View raw LLM call"
                    style={{
                      marginLeft: 6,
                      background: "transparent",
                      border: "1px solid rgba(26,24,21,0.15)",
                      color: "var(--ink-2)",
                      borderRadius: 3,
                      fontSize: 9,
                      fontFamily: "var(--mono, monospace)",
                      padding: "1px 4px",
                      cursor: "pointer",
                    }}
                  >
                    raw
                  </button>
                )}
              </div>
              <div
                className="rt-bubble"
                style={
                  isThinking
                    ? { opacity: 0.55, fontStyle: "italic" }
                    : reply?.status === "error"
                      ? { color: "var(--you)" }
                      : !reply
                        ? { opacity: 0.4, fontStyle: "italic" }
                        : undefined
                }
              >
                {bubble}
              </div>
            </div>
          );
        })}
      </div>
      {openTraceId && (
        <TraceModal
          traceId={openTraceId}
          onClose={() => setOpenTraceId(null)}
        />
      )}
    </div>
  );
}
