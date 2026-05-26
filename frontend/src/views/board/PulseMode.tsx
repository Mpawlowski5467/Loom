import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useApp } from "../../context/app-ctx";

type LiveState = "running" | "idle";

function seedFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 1000;
}

function strokeFor(state: LiveState): string {
  return state === "running" ? "var(--agent)" : "var(--ink-3)";
}

export function PulseMode(): ReactNode {
  const { agents, agentActivity } = useApp();
  const polylineRefs = useRef<Record<string, SVGPolylineElement | null>>({});

  useEffect(() => {
    let raf = 0;
    let stopped = false;
    const start = performance.now();
    const tick = () => {
      if (stopped) return;
      const t = (performance.now() - start) / 1000;
      for (const a of agents) {
        const el = polylineRefs.current[a.id];
        if (!el) continue;
        const live = agentActivity[a.name.toLowerCase()];
        const state: LiveState = live?.state === "running" ? "running" : "idle";
        const realPulse = live?.pulse ?? [];
        const seed = seedFor(a.id);
        const pts: string[] = [];
        for (let i = 0; i < 80; i++) {
          const x = (i / 79) * 600;
          // Background ambient curve so idle rows still look alive
          const base = Math.sin(t * 0.4 - i * 0.18 - seed * 0.07) * 0.18;
          const mod = Math.sin(t * 1.7 - i * 0.38 - seed * 0.14) * 0.12;
          // Real backend pulse (last N samples) drives the burst when present
          const pulseIdx = Math.floor((i / 79) * Math.max(1, realPulse.length));
          const realIntensity = realPulse[pulseIdx] ?? 0;
          const burst =
            state === "running"
              ? Math.max(0, Math.sin(t * 3.5 - i * 0.09)) * 0.85
              : realIntensity * Math.max(0, Math.sin(t * 2.2 - i * 0.18)) * 0.6;
          const y = 18 - (base + mod + burst) * 15;
          pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
        }
        el.setAttribute("points", pts.join(" "));
        el.setAttribute("stroke", strokeFor(state));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [agents, agentActivity]);

  return (
    <div className="pulse-mode">
      {agents.map((a) => {
        const live = agentActivity[a.name.toLowerCase()];
        const state: LiveState = live?.state === "running" ? "running" : "idle";
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
                stroke={strokeFor(state)}
                strokeWidth={1.3}
                points=""
              />
            </svg>
            <div className="pulse-stats">
              <div>{state}</div>
              <div>{runs} runs</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
