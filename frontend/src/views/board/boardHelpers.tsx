import type { ReactNode } from "react";
import type { AgentActivity } from "../../api/activity";
import type { Agent, AgentState } from "../../data/types";
import { formatRelative } from "../../data/formatDate";

/** Relative timestamp like "5m ago". Falls back to the raw string if unparseable. */
export function formatRelativeTime(iso: string): string {
  return formatRelative(iso);
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
        <span
          key={i}
          data-wikilink=""
          className="rounded-sm bg-chip px-1 text-chip-foreground"
        >
          {p.slice(2, -2).split("|")[0]}
        </span>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

/**
 * True when a trace's caller label attributes the call to the given agent id.
 * Caller conventions across the backend: the bare id ("weaver"), board runs
 * ("manual:<id>"), council/chat fan-out ("council:<id>", "chat:<id>"), and
 * dotted sub-callers ("<id>.classify").
 */
export function callerMatchesAgent(caller: string, agentId: string): boolean {
  return (
    caller === agentId ||
    caller === `manual:${agentId}` ||
    caller.startsWith(`${agentId}.`) ||
    caller.endsWith(`:${agentId}`)
  );
}

/** The agent's effective state: live "running" beats the static state. */
export function liveAgentState(
  agent: Agent,
  activity: AgentActivity | undefined,
): AgentState {
  return activity?.state === "running" ? "running" : agent.state;
}

/** Built-in ids ("weaver") read as names ("Weaver"); custom names stay as typed. */
export function agentDisplayName(agent: Pick<Agent, "name">): string {
  return /^[a-z]+$/.test(agent.name)
    ? agent.name[0]!.toUpperCase() + agent.name.slice(1)
    : agent.name;
}
