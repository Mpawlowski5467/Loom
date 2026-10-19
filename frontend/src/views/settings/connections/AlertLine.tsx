import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** An inline error, announced assertively. */
export function AlertLine({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p role="alert" className={cn("text-sm text-danger-foreground", className)}>
      {children}
    </p>
  );
}
