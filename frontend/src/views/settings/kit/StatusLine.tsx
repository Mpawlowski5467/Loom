import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type StatusTone = "muted" | "ok" | "warn" | "error";

const TONE: Record<StatusTone, string> = {
  muted: "text-muted-foreground",
  ok: "text-ok-foreground",
  warn: "text-warning-foreground",
  error: "text-danger-foreground",
};

/** A one-line result or progress message, announced politely. */
export function StatusLine({
  tone = "muted",
  children,
  className,
}: {
  tone?: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <p role="status" className={cn("text-sm", TONE[tone], className)}>
      {children}
    </p>
  );
}
