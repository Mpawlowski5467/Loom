import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** One row of a settings list (a vault, an archived note): details, actions. */
export function ListCard({ className, ...props }: ComponentProps<"article">) {
  return (
    <article
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 text-sm text-card-foreground",
        className,
      )}
      {...props}
    />
  );
}
