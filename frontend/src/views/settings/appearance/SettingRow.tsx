import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SettingRowProps {
  title: string;
  description?: ReactNode;
  /** id of the heading, for controls that reference it via aria-labelledby */
  titleId?: string;
  children: ReactNode;
  className?: string;
}

/** One titled block of the Appearance page: label on top, controls below. */
export function SettingRow({
  title,
  description,
  titleId,
  children,
  className,
}: SettingRowProps) {
  return (
    <section className={cn("flex flex-col gap-3 py-5", className)}>
      <div className="flex flex-col gap-0.5">
        <h3 id={titleId} className="text-sm font-medium text-foreground">
          {title}
        </h3>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}
