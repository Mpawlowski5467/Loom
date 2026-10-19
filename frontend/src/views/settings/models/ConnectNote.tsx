import type { ReactNode } from "react";

/** A short "how this provider connects" note with its call to action. */
export function ConnectNote({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      role="note"
      className="flex flex-col gap-3 rounded-lg border border-brand/30 bg-brand/5 p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <strong className="text-sm font-medium text-foreground">{title}</strong>
        <span className="text-sm text-secondary-foreground">{children}</span>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
