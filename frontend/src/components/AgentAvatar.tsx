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
/** Custom agents get a stable tint from their name. */
const CUSTOM = [
  "bg-community-1/15 text-community-1",
  "bg-community-2/15 text-community-2",
  "bg-community-3/15 text-community-3",
  "bg-community-4/15 text-community-4",
];

function tintFor(name: string, human: boolean): string {
  if (TINTS[name]) return TINTS[name];
  if (human) return HUMAN;
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CUSTOM[h % CUSTOM.length]!;
}

/** Initials avatar for an agent (or "you"); decorative next to its name. */
export function AgentAvatar({
  actor,
  size = "sm",
  className,
}: {
  actor: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const name = actorName(actor);
  const initials = name === "you" ? "Y" : name.slice(0, 2).toUpperCase();
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-mono font-medium",
        size === "sm"
          ? "size-5 text-[9px]"
          : size === "md"
            ? "size-7 text-[11px]"
            : "size-9 text-xs",
        tintFor(name, name === "you"),
        className,
      )}
    >
      {initials}
    </span>
  );
}
