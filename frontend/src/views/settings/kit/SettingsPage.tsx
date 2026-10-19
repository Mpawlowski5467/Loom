import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The column every Settings section renders in (same as Appearance). */
export function SettingsPage({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-3xl flex-col gap-10 px-1 pb-10",
        className,
      )}
    >
      {children}
    </div>
  );
}
