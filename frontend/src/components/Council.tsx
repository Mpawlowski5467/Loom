import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useApp } from "../context/app-ctx";

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
        <div className="council-h-sub">7 agents · transparent thread</div>
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
          return (
            <div key={m.id} className={`council-msg ${cls}`}>
              <div className="who">{label}</div>
              <div className="bubble">{renderInline(m.body)}</div>
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
    </aside>
  );
}
