import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useApp } from "../context/app-ctx";
import { AgentBlob } from "./primitives/AgentBlob";
import { TraceModal } from "./TraceModal";

function renderInline(text: string): ReactNode {
  // Just bold the [[wikilinks]] visually as serif italic blue spans (no nav from council).
  const parts = text.split(/(\[\[[^\]]+\]\])/g);
  return parts.map((p, i) => {
    if (p.startsWith("[[") && p.endsWith("]]")) {
      const inner = p.slice(2, -2).split("|")[0];
      return (
        <span
          key={i}
          style={{
            fontStyle: "italic",
            color: "var(--agent)",
            fontFamily: "var(--serif)",
          }}
        >
          {inner}
        </span>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

export function Council(): ReactNode {
  const { council, postCouncilMessage } = useApp();
  const [text, setText] = useState("");
  const [openTraceId, setOpenTraceId] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [council]);

  const send = () => {
    if (!text.trim()) return;
    postCouncilMessage(text.trim());
    setText("");
  };

  return (
    <aside className="council" aria-label="Loom Council">
      <div className="council-h">
        <div className="council-h-title">Loom Council</div>
        <div className="council-h-sub">
          Weaver · Spider · Archivist · Scribe · Sentinel
        </div>
      </div>
      <div className="council-log" ref={logRef}>
        {council.map((m) => {
          const cls =
            m.who === "you"
              ? "you"
              : m.who === "summary"
                ? "summary"
                : "agent";
          const label =
            m.who === "you"
              ? "you"
              : m.who === "summary"
                ? "summary"
                : m.who.replace("agent:", "");
          const agentId = m.who.startsWith("agent:") ? m.who.slice(6) : null;
          return (
            <div key={m.id} className={`council-msg ${cls}`}>
              <div className="who">
                {agentId && (
                  <AgentBlob
                    agent={agentId}
                    state={m.pending ? "running" : "idle"}
                    size={26}
                  />
                )}
                <span className="who-label">{label}</span>
                {m.traceId && (
                  <button
                    type="button"
                    onClick={() => setOpenTraceId(m.traceId!)}
                    title="View raw LLM call"
                    style={{
                      marginLeft: "auto",
                      background: "transparent",
                      border: "1px solid rgba(26,24,21,0.15)",
                      color: "var(--ink-2, #5c5851)",
                      borderRadius: 4,
                      fontSize: 10,
                      fontFamily: "var(--mono, monospace)",
                      padding: "2px 6px",
                      cursor: "pointer",
                    }}
                  >
                    raw call
                  </button>
                )}
              </div>
              <div
                className="bubble"
                style={m.pending ? { opacity: 0.6, fontStyle: "italic" } : undefined}
              >
                {renderInline(m.body)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="council-input">
        <input
          className="input"
          placeholder="ask the council…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              send();
            }
          }}
        />
      </div>
      {openTraceId && (
        <TraceModal
          traceId={openTraceId}
          onClose={() => setOpenTraceId(null)}
        />
      )}
    </aside>
  );
}
