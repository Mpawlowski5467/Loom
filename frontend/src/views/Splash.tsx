import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { LoomMark } from "../components/primitives/LoomMark";

interface Props {
  onDone: () => void;
}

const CORNER = "absolute size-[18px] border-border-strong";

/** The first-visit intro: the woven mark draws itself, then fades out. */
export function Splash({ onDone }: Props): ReactNode {
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const settle = setTimeout(() => setFading(true), 3000);
    const done = setTimeout(() => onDone(), 3600);
    return () => {
      clearTimeout(settle);
      clearTimeout(done);
    };
  }, [onDone]);

  return (
    <div
      className={cn(
        "fixed inset-0 z-[9999] flex cursor-pointer flex-col items-center justify-center bg-background text-foreground transition-opacity duration-600 ease-[cubic-bezier(.2,.7,.3,1)]",
        fading && "pointer-events-none opacity-0",
      )}
      onClick={() => onDone()}
      role="presentation"
    >
      <span
        aria-hidden="true"
        className={cn(CORNER, "top-8 left-8 border-t border-l")}
      />
      <span
        aria-hidden="true"
        className={cn(CORNER, "top-8 right-8 border-t border-r")}
      />
      <span
        aria-hidden="true"
        className={cn(CORNER, "bottom-8 left-8 border-b border-l")}
      />
      <span
        aria-hidden="true"
        className={cn(CORNER, "right-8 bottom-8 border-r border-b")}
      />

      <div className="flex flex-col items-center gap-5">
        <LoomMark size={148} dur={2.6} loop color="currentColor" />
        <div className="mt-1 flex items-center gap-3">
          <span className="animate-word-reveal font-serif text-[44px] font-medium tracking-tight">
            Loom
          </span>
          <span className="animate-late-fade font-mono text-[11px] tracking-wider text-muted-foreground">
            v{(import.meta.env.VITE_APP_VERSION as string | undefined) ?? "dev"}
          </span>
        </div>
        <div
          aria-hidden="true"
          className="relative mt-3 h-px w-[280px] overflow-hidden bg-border-strong"
        >
          <span className="absolute -top-px left-0 h-[3px] w-[60px] animate-rail bg-foreground" />
        </div>
        <div className="flex animate-late-fade items-center gap-2 font-mono text-[10px] tracking-[2px] text-muted-foreground uppercase">
          <span
            aria-hidden="true"
            className="size-[5px] animate-blink rounded-full bg-brand"
          />
          preparing your weave
        </div>
      </div>
    </div>
  );
}
