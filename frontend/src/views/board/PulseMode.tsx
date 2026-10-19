import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useApp } from "../../context/app-ctx";
import { AgentAvatar } from "@/components/AgentAvatar";
import type { AgentState } from "../../data/types";
import { AgentStateBadge } from "./AgentStateBadge";
import { agentDisplayName, liveAgentState } from "./boardHelpers";
import { agentBoardState, type AgentStateContext } from "./boardStats";

function strokeFor(state: AgentState, hasRecentActivity: boolean): string {
  if (state === "running") return "var(--brand)";
  if (hasRecentActivity) return "var(--secondary-foreground)";
  return "var(--muted-foreground)";
}

const WIDTH = 600;
const MIDLINE = 18;
const AMPLITUDE = 14;

/** Live heartbeat lines per agent, from the activity pulse samples. */
export function PulseMode({
  stateCtx,
}: {
  stateCtx: AgentStateContext;
}): ReactNode {
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
        const live = agentActivity[a.id];
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
      <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
        No agents to chart. Add an agent or run one to see its pulse.
      </p>
    );
  }

  return (
    <ul
      aria-label="Agent pulse"
      className="flex flex-col divide-y divide-border rounded-lg border border-border"
    >
      {agents.map((a) => {
        const live = agentActivity[a.id];
        const runs = live?.action_count ?? a.stats.runs;
        return (
          <li key={a.id} className="flex items-center gap-3 px-4 py-2">
            <span className="flex w-36 shrink-0 items-center gap-2 text-sm text-foreground">
              <AgentAvatar actor={a.id} size="md" />
              {agentDisplayName(a)}
            </span>
            <svg
              aria-hidden="true"
              className="h-9 min-w-0 flex-1"
              viewBox="0 0 600 36"
              preserveAspectRatio="none"
            >
              <polyline
                ref={(el) => {
                  polylineRefs.current[a.id] = el;
                }}
                fill="none"
                strokeWidth={1.3}
                points=""
              />
            </svg>
            <span className="flex w-40 shrink-0 items-center justify-end gap-2">
              <AgentStateBadge state={agentBoardState(a.id, live, stateCtx)} />
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {runs} runs
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
