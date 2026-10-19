import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SettingsGroupProps {
  title: string;
  description?: ReactNode;
  /** Buttons beside the heading. */
  actions?: ReactNode;
  /** 1 for the page's title block, 2 (default) for sections below it. */
  level?: 1 | 2 | 3;
  children?: ReactNode;
  className?: string;
}

const HEADING = {
  1: "text-xl font-semibold tracking-tight text-foreground",
  2: "text-base font-semibold text-foreground",
  3: "text-sm font-medium text-foreground",
} as const;

/** A titled group of settings: heading, optional description and actions. */
export function SettingsGroup({
  title,
  description,
  actions,
  level = 2,
  children,
  className,
}: SettingsGroupProps) {
  const id = useId();
  const Heading = `h${level}` as const;
  return (
    <section
      aria-labelledby={id}
      className={cn("flex flex-col gap-4", className)}
    >
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Heading id={id} className={HEADING[level]}>
            {title}
          </Heading>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </header>
      {children}
    </section>
  );
}
