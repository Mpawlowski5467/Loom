import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useApp } from "../../context/app-ctx";
import { StatusBadge } from "../../components/primitives/StatusBadge";
import type { AgentState } from "../../data/types";
import { boardStatus, liveAgentState } from "./boardHelpers";

function strokeFor(state: AgentState, hasRecentActivity: boolean): string {
  if (state === "running") return "var(--agent)";
  if (hasRecentActivity) return "var(--ink-2)";
  return "var(--ink-3)";
}

const WIDTH = 600;
const MIDLINE = 18;
const AMPLITUDE = 14;

export function PulseMode(): ReactNode {
  const { agents, agentActivity } = useApp();
  const polylineRefs = useRef<Record<string, SVGPolylineElement | null>>({});

  useEffect(() => {
    let raf = 0;
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      const t = performance.now() / 1000;
      for (const a of agents) {
        const el = polylineRefs.current[a.id];
        if (!el) continue;
        const live = agentActivity[a.name.toLowerCase()];
        const state = liveAgentState(a, live);
        const pulse = live?.pulse ?? [];
        const recentActivity = pulse.some((v) => v > 0.05);

        const pts: string[] = [];
        const n = Math.max(pulse.length, 60);
        for (let i = 0; i < n; i++) {
          const x = (i / (n - 1)) * WIDTH;
          const pulseIdx =
            pulse.length > 0
              ? Math.min(
                  pulse.length - 1,
                  Math.floor((i / (n - 1)) * pulse.length),
                )
              : 0;
          const intensity = pulse[pulseIdx] ?? 0;

          // Heartbeat wave: amplitude tracks intensity, so idle slots are flat.
          // Running tip wiggles faster/taller to feel live.
          let y = MIDLINE;
          if (intensity > 0.02) {
            const speed = state === "running" ? 6 : 2.2;
            y -= Math.sin(t * speed - i * 0.35) * intensity * AMPLITUDE;
          }
          pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
        }
        el.setAttribute("points", pts.join(" "));
        el.setAttribute("stroke", strokeFor(state, recentActivity));
        el.setAttribute(
          "stroke-width",
          state === "running" ? "1.6" : recentActivity ? "1.2" : "1",
        );
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [agents, agentActivity]);

  if (agents.length === 0) {
    return (
      <div className="board-empty">
        No agents to chart. Add an agent or run one to see its pulse.
      </div>
    );
  }

  return (
    <div className="pulse-mode">
      {agents.map((a) => {
        const live = agentActivity[a.name.toLowerCase()];
        const status = boardStatus(a, live);
        const recentActivity = (live?.pulse ?? []).some((v) => v > 0.05);
        const runs = live?.action_count ?? a.stats.runs;
        return (
          <div key={a.id} className="pulse-row">
            <div className="pulse-meta">
              <span className="pulse-icon" aria-hidden="true">
                {a.icon}
              </span>
              <span className="pulse-name">{a.name}</span>
            </div>
            <svg
              className="pulse-spark"
              viewBox="0 0 600 36"
              preserveAspectRatio="none"
            >
              <polyline
                ref={(el) => {
                  polylineRefs.current[a.id] = el;
                }}
                fill="none"
                stroke={strokeFor(status.state, recentActivity)}
                strokeWidth={1.3}
                points=""
              />
            </svg>
            <div className="pulse-stats">
              <StatusBadge state={status.state} label={status.label} />
              <div>{runs} runs</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
