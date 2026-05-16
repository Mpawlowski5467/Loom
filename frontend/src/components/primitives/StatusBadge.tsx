import type { ReactNode } from "react";
import type { AgentState } from "../../data/types";

interface Props {
  state: AgentState;
  label?: string;
}

export function StatusBadge({ state, label }: Props): ReactNode {
  return (
    <span className="status-badge" data-state={state}>
      <span className="pulse-dot" />
      {label ?? state}
    </span>
  );
}
