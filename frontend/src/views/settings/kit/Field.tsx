import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface FieldProps {
  /** The visible label; it names the control the label wraps. */
  label: ReactNode;
  /** Help text under the control (not part of its accessible name). */
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** A label wrapping its control, with an optional hint below. */
export function Field({ label, hint, children, className }: FieldProps) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">{label}</span>
        {children}
      </label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
