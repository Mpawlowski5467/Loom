import { cn } from "@/lib/utils";

const FILL = [
  "bg-community-1",
  "bg-community-2",
  "bg-community-3",
  "bg-community-4",
];

/** A note's community color, or the neutral tone for "Other". */
export function CommunityDot({
  slot,
  className,
}: {
  /** Community slot 0–3; null (or off) draws the neutral dot. */
  slot: number | null | undefined;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-2.5 shrink-0 rounded-full",
        slot != null ? FILL[slot] : "bg-muted-foreground",
        className,
      )}
    />
  );
}
