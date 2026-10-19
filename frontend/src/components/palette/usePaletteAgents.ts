import { useEffect, useState } from "react";
import { fetchAgentActivity } from "@/api/activity";
import { listAgentRegistry } from "@/api/agentsRegistry";
import { agents as builtInAgents } from "@/data/agents";

export interface PaletteAgent {
  id: string;
  name: string;
  role: string;
  layer: string;
  running: boolean;
}

const FALLBACK: PaletteAgent[] = builtInAgents.map((a) => ({
  id: a.id,
  name: a.name,
  role: a.role,
  layer: a.layer,
  running: false,
}));

/** Every agent (built-in and custom) with its live state, fetched on open. */
export function usePaletteAgents(): PaletteAgent[] {
  const [list, setList] = useState<PaletteAgent[]>(FALLBACK);
  useEffect(() => {
    let active = true;
    Promise.allSettled([listAgentRegistry(), fetchAgentActivity()]).then(
      ([registry, activity]) => {
        if (!active) return;
        const running = new Set(
          activity.status === "fulfilled"
            ? activity.value
                .filter((a) => a.state === "running")
                .map((a) => a.name)
            : [],
        );
        const base =
          registry.status === "fulfilled" && registry.value.length > 0
            ? registry.value.map((r) => ({
                id: r.id,
                name: r.name,
                role: r.role,
                layer: r.layer,
                running: false,
              }))
            : FALLBACK;
        setList(base.map((a) => ({ ...a, running: running.has(a.id) })));
      },
    );
    return () => {
      active = false;
    };
  }, []);
  return list;
}
