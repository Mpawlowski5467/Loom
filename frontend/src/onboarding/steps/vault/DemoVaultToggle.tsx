import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { ToggleCard } from "../../StepLayout";

/** Seeds the new vault with example notes when pressed. */
export function DemoVaultToggle({
  pressed,
  onToggle,
}: {
  pressed: boolean;
  onToggle: () => void;
}): ReactNode {
  return (
    <ToggleCard
      pressed={pressed}
      onClick={onToggle}
      className="flex w-full items-start gap-3 px-4 py-3.5"
    >
      <Sparkles
        aria-hidden="true"
        className="mt-px size-[18px] shrink-0 text-brand"
      />
      <span className="flex flex-1 flex-col gap-1">
        <span className="text-sm font-semibold">Try the demo vault</span>
        <span className="text-xs/relaxed text-muted-foreground">
          Seed this vault with example notes so you start on a populated graph
          instead of an empty one — explore it, then delete what you don't need.
        </span>
      </span>
      <span className="shrink-0 font-mono text-xs text-muted-foreground">
        {pressed ? "On" : "Off"}
      </span>
    </ToggleCard>
  );
}
