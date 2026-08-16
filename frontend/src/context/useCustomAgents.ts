import { useCallback, useEffect, useState } from "react";
import { listAgentRegistry } from "../api/agentsRegistry";
import type { AgentRegistryRecord } from "../api/agentsRegistry";
import type { Agent } from "../data/types";

function toCustomAgents(list: AgentRegistryRecord[]): Agent[] {
  return list
    .filter((agent) => !agent.system)
    .map((agent) => ({
      id: agent.id,
      name: agent.name,
      layer: agent.layer,
      role: agent.role,
      icon: agent.icon,
      state: "idle",
      stats: { runs: 0, lastRun: "—" },
      lastAction: "",
    }));
}

/** Own custom-agent registry loading outside the AppContext shell. */
export function useCustomAgents(enabled: boolean): {
  customAgents: Agent[];
  refreshCustomAgents: () => Promise<void>;
} {
  const [customAgents, setCustomAgents] = useState<Agent[]>([]);
  const refreshCustomAgents = useCallback(async () => {
    try {
      const list = await listAgentRegistry();
      setCustomAgents(toCustomAgents(list));
    } catch {
      // Backend unreachable — leave the last successful list intact.
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void listAgentRegistry()
      .then((list) => {
        if (!cancelled) setCustomAgents(toCustomAgents(list));
      })
      .catch(() => {
        // Backend unreachable — leave the last successful list intact.
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { customAgents, refreshCustomAgents };
}
