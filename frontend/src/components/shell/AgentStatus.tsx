import { useApp } from "@/context/app-ctx";
import { cn } from "@/lib/utils";

function capitalize(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** "Agents idle" or "Weaver running…", from the activity poll. */
export function AgentStatus() {
  const { agentActivity, offline } = useApp();
  const running = Object.values(agentActivity)
    .filter((a) => a.state === "running")
    .map((a) => capitalize(a.name));

  const label = offline
    ? "Agents offline"
    : running.length === 0
      ? "Agents idle"
      : running.length === 1
        ? `${running[0]} running…`
        : `${running[0]} +${running.length - 1} running…`;

  return (
    <div
      role="status"
      aria-live="polite"
      className="hidden items-center gap-2 text-xs whitespace-nowrap text-muted-foreground md:flex"
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-2 rounded-full",
          offline
            ? "bg-muted-foreground"
            : running.length > 0
              ? "animate-pulse bg-brand"
              : "bg-ok-foreground",
        )}
      />
      {label}
    </div>
  );
}
