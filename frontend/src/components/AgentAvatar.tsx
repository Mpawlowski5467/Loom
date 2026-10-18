import { actorName } from "@/data/actors";
import { cn } from "@/lib/utils";

/** Per-agent tint; static class names so Tailwind generates them. */
const TINTS: Record<string, string> = {
  weaver: "bg-community-1/15 text-community-1",
  spider: "bg-community-3/15 text-community-3",
  archivist: "bg-community-2/15 text-community-2",
  scribe: "bg-community-4/15 text-community-4",
  sentinel: "bg-ok text-ok-foreground",
  researcher: "bg-brand/15 text-brand",
  standup: "bg-muted text-secondary-foreground",
};
const HUMAN = "bg-accent text-foreground";

/** Initials avatar for an agent (or "you"); decorative next to its name. */
export function AgentAvatar({
  actor,
  size = "sm",
  className,
}: {
  actor: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const name = actorName(actor);
  const initials = name === "you" ? "Y" : name.slice(0, 2).toUpperCase();
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-mono font-medium",
        size === "sm" ? "size-5 text-[9px]" : "size-7 text-[11px]",
        TINTS[name] ?? HUMAN,
        className,
      )}
    >
      {initials}
    </span>
  );
}
