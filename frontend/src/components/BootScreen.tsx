import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { LoomMark } from "./primitives/LoomMark";
import { Button } from "./ui/button";

const LAYOUT =
  "flex flex-col items-center justify-center gap-4 px-6 text-center text-foreground";
const SCREEN = `fixed inset-0 z-50 bg-background ${LAYOUT}`;
/** Fills only the area that failed (a view, the header), not the window. */
const CONTAINED = `min-h-0 flex-1 py-8 ${LAYOUT}`;

function Wordmark() {
  return (
    <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
      loom
    </span>
  );
}

/** Full-screen boot state while the config loads: the mark drawing itself. */
export function BootScreen(): ReactNode {
  return (
    <div role="status" aria-live="polite" className={SCREEN}>
      <LoomMark size={40} dur={2.6} loop />
      <Wordmark />
    </div>
  );
}

interface BootErrorProps {
  icon: LucideIcon;
  message: ReactNode;
  actionLabel: string;
  onAction?: () => void;
  /** Render in place instead of covering the window. */
  contained?: boolean;
}

/** A failure with one recovery action (Retry, Try again). */
export function BootError({
  icon: Icon,
  message,
  actionLabel,
  onAction,
  contained = false,
}: BootErrorProps): ReactNode {
  return (
    <div role="alert" className={contained ? CONTAINED : SCREEN}>
      <span className="flex size-10 items-center justify-center rounded-full border border-border-strong text-muted-foreground">
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <Wordmark />
      <p className="max-w-xs text-sm/relaxed text-secondary-foreground">
        {message}
      </p>
      {onAction && (
        <Button type="button" variant="outline" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
