import type { ReactNode } from "react";
import type { AgentActivity } from "../../api/activity";
import type { Agent, AgentState } from "../../data/types";

/** Relative timestamp like "5m ago". Falls back to the raw string if unparseable. */
export function formatRelativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const secs = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/** Relative label from an "age in seconds" value (e.g. activity timestamps). */
export function formatAge(ageSeconds: number): string {
  return formatRelativeTime(
    new Date(Date.now() - ageSeconds * 1000).toISOString(),
  );
}

/** Render a changelog target, styling any `[[wikilink]]` (bare paths get wrapped). */
export function renderTarget(target: string): ReactNode {
  const wrapped =
    target.includes("[[") || !target
      ? target
      : `[[${target.replace(/\.md$/i, "")}]]`;
  return wrapped.split(/(\[\[[^\]]+\]\])/g).map((p, i) => {
    if (p.startsWith("[[") && p.endsWith("]]")) {
      return (
        <span key={i} className="board-wikilink">
          {p.slice(2, -2).split("|")[0]}
        </span>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

/** The agent's effective state: live "running" beats the static state. */
export function liveAgentState(
  agent: Agent,
  activity: AgentActivity | undefined,
): AgentState {
  return activity?.state === "running" ? "running" : agent.state;
}

export interface BoardStatus {
  /** Drives StatusBadge dot color (a real AgentState). */
  state: AgentState;
  /** Display label — adds the "settling" nuance for recently-active agents. */
  label: string;
}

/**
 * Single source of truth for how an agent's status reads across the board
 * (cards, pulse rows, round table). "settling" = idle but with recent pulse
 * activity; it renders with the idle dot so the legend stays three-state.
 */
export function boardStatus(
  agent: Agent,
  activity: AgentActivity | undefined,
): BoardStatus {
  const state = liveAgentState(agent, activity);
  if (state === "running") return { state, label: "running" };
  const recent = (activity?.pulse ?? []).some((v) => v > 0.05);
  if (recent) return { state: "idle", label: "settling" };
  return { state, label: state };
}
