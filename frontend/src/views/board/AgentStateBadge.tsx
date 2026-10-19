import { cn } from "@/lib/utils";
import type { AgentBoardState } from "./boardStats";

const STYLE: Record<AgentBoardState, { dot: string; label: string }> = {
  running: { dot: "bg-brand animate-pulse", label: "Running" },
  watching: { dot: "bg-ok", label: "Watching" },
  scheduled: { dot: "bg-secondary-foreground", label: "Scheduled" },
  idle: { dot: "bg-border-strong", label: "Idle" },
};

/** Running / Watching / Scheduled / Idle with a colored dot. */
export function AgentStateBadge({
  state,
  className,
}: {
  state: AgentBoardState;
  className?: string;
}) {
  const s = STYLE[state];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium",
        state === "idle" ? "text-muted-foreground" : "text-foreground",
        className,
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}
