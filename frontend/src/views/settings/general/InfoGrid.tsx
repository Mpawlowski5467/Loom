import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A two-column grid of read-only label/value tiles. */
export function InfoGrid({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</dl>;
}

/** One label/value tile; `mono` for versions, timestamps, hosts and counts. */
export function InfoRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-card px-3 py-2.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "text-sm font-medium break-words text-foreground",
          mono && "font-mono",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
