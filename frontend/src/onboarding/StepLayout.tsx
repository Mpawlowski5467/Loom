import type { ComponentProps, ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** A wizard step: its header, body and actions in one column. */
export function Step({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-4", className)} {...props} />;
}

/** The step's serif title and muted lede. */
export function StepHeader({
  title,
  description,
}: {
  title: string;
  description?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-1.5">
      <h2 className="font-serif text-2xl font-medium tracking-tight text-foreground">
        {title}
      </h2>
      {description && (
        <p className="text-sm/relaxed text-muted-foreground">{description}</p>
      )}
    </header>
  );
}

/** The button row: stacked (primary on top) on phones, right-aligned from sm. */
export function StepActions({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:[&>button]:min-w-24",
        className,
      )}
      {...props}
    />
  );
}

/** A labelled form control; pass the control's `id` so the label targets it. */
export function Field({
  id,
  label,
  children,
  className,
}: {
  id: string;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

/** A card-sized toggle button (provider choice, demo vault). */
export function ToggleCard({
  pressed,
  className,
  ...props
}: Omit<ComponentProps<"button">, "type"> & { pressed: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cn(
        "rounded-lg border border-border bg-card text-left text-foreground transition-colors duration-200 ease-[cubic-bezier(.2,.7,.3,1)] outline-none",
        "hover:border-border-strong focus-visible:ring-2 focus-visible:ring-ring",
        "aria-pressed:border-brand aria-pressed:bg-accent",
        className,
      )}
      {...props}
    />
  );
}
