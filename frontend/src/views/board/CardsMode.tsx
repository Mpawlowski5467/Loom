import type { ReactNode } from "react";
import { useApp } from "../../context/app-ctx";
import { StatusBadge } from "../../components/primitives/StatusBadge";

function renderTarget(target: string): ReactNode {
  const parts = target.split(/(\[\[[^\]]+\]\])/g);
  return parts.map((p, i) => {
    if (p.startsWith("[[") && p.endsWith("]]")) {
      return (
        <span
          key={i}
          style={{
            color: "var(--agent)",
            fontFamily: "var(--serif)",
            fontStyle: "italic",
          }}
        >
          {p.slice(2, -2).split("|")[0]}
        </span>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

export function CardsMode(): ReactNode {
  const { agents, changelog } = useApp();
  const loom = agents.filter((a) => a.layer === "loom");
  const shuttle = agents.filter((a) => a.layer === "shuttle");

  const renderCard = (a: (typeof agents)[number]) => (
    <div key={a.id} className="agent-card">
      <div className="agent-card-h">
        <span className="agent-card-icon" aria-hidden="true">
          {a.icon}
        </span>
        <span className="agent-card-name">{a.name}</span>
        <StatusBadge state={a.state} />
      </div>
      <div className="agent-card-role">{a.role}</div>
      <div className="agent-card-stats">
        <span>
          <b>{a.stats.runs}</b> runs
        </span>
        <span>last: {a.stats.lastRun}</span>
      </div>
      <div className="agent-card-last">{a.lastAction}</div>
    </div>
  );

  return (
    <div>
      <div className="section-divider">Loom Layer · vault hygiene</div>
      <div className="agents-grid">{loom.map(renderCard)}</div>

      <div className="section-divider">Shuttle Layer · outbound</div>
      <div className="agents-grid">{shuttle.map(renderCard)}</div>

      <div className="section-divider">Recent activity</div>
      <div className="changelog">
        {changelog.slice(0, 15).map((ev) => (
          <div key={ev.id} className="changelog-row">
            <span className="changelog-ts">{ev.ts}</span>
            <span className="changelog-agent">{ev.agent}</span>
            <span>
              {ev.action} {renderTarget(ev.target)}
            </span>
            <span className={`changelog-verdict ${ev.sentinel}`}>
              {ev.sentinel === "ok" ? "✓" : ev.sentinel === "warn" ? "⚠" : "✕"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
