import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** A bordered card for one provider, connection, vault or result. */
export function SettingsCard({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border bg-card p-4 text-sm text-card-foreground",
        className,
      )}
      {...props}
    />
  );
}
