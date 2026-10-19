import type { ReactNode } from "react";

interface ReaderHeaderProps {
  path: string;
  title: string;
  byline: ReactNode;
  actions?: ReactNode;
}

/** File path, heading and byline shared by every thread reader. */
export function ReaderHeader({
  path,
  title,
  byline,
  actions,
}: ReaderHeaderProps) {
  return (
    <header className="flex flex-col gap-2">
      <p className="font-mono text-xs break-all text-muted-foreground">
        {path}
      </p>
      <div className="flex flex-wrap items-start gap-3">
        <h1
          id="thread-title"
          className="min-w-0 flex-1 text-2xl font-semibold tracking-tight text-foreground"
        >
          {title}
        </h1>
        {actions}
      </div>
      <p className="text-sm text-muted-foreground">{byline}</p>
    </header>
  );
}
