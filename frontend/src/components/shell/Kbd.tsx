import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A keyboard hint, set in the mono face. */
export function Kbd({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 items-center rounded border whitespace-nowrap border-border bg-muted px-1.5 font-mono text-[11px] text-muted-foreground",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
