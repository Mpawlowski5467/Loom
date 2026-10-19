import { useState } from "react";
import { formatRunResult, runAgent } from "@/api/agents";
import { useApp } from "@/context/app-ctx";
import type { Agent } from "@/data/types";
import { agentDisplayName } from "./boardHelpers";

/** Run an agent from the Board, one run per agent at a time. */
export function useAgentRunner() {
  const { pushToast } = useApp();
  const [running, setRunning] = useState<ReadonlySet<string>>(new Set());
  const run = async (a: Agent) => {
    if (running.has(a.id)) return;
    setRunning((prev) => new Set(prev).add(a.id));
    try {
      const res = await runAgent(a.id);
      pushToast({
        icon: "▶",
        agent: a.id,
        body: formatRunResult(a.id, res.result),
      });
    } catch (err) {
      pushToast({
        icon: "⚠",
        agent: "sentinel",
        body: `${agentDisplayName(a)} run failed: ${err instanceof Error ? err.message : "unknown error"}`,
      });
    } finally {
      setRunning((prev) => {
        const next = new Set(prev);
        next.delete(a.id);
        return next;
      });
    }
  };
  return { running, run };
}
