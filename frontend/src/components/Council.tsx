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

  // A Council turn is in flight while the trailing reply bubble is still
  // pending. Block new sends until it resolves so we don't fan out a second
  // ~6-call stream over the first.
  const streaming = council.length > 0 && council[council.length - 1].pending;

  const send = () => {
    if (!text.trim() || streaming) return;
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
                    className="raw-call-btn"
                  >
                    raw call
                  </button>
                )}
              </div>
              {m.contributions && m.contributions.length > 0 && (
                <div className="council-contribs">
                  {m.contributions.map((c, idx) => (
                    <div key={`${c.agent}-${idx}`} className="council-contrib">
                      <div className="contrib-h">
                        <AgentBlob agent={c.agent} state="idle" size={20} />
                        <span className="contrib-label">{c.agent}</span>
                        {c.traceId && (
                          <button
                            type="button"
                            onClick={() => setOpenTraceId(c.traceId!)}
                            title={`View ${c.agent}'s raw LLM call`}
                            className="raw-call-btn"
                          >
                            raw call
                          </button>
                        )}
                      </div>
                      <div
                        className="contrib-body"
                        style={c.error ? { color: "var(--you)", fontStyle: "italic" } : undefined}
                      >
                        {c.error
                          ? `⚠ ${c.error}`
                          : renderInline(c.body)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
          placeholder={streaming ? "council is responding…" : "ask the council…"}
          value={text}
          disabled={streaming}
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
