import type { ReactNode } from "react";
import { LoomMark } from "@/components/primitives/LoomMark";
import { Button } from "@/components/ui/button";
import { Step, StepActions } from "../StepLayout";

interface Props {
  onNext: () => void;
}

const POINTS = [
  "Everything stays on this machine. No cloud, no telemetry.",
  "Bring your own AI provider — OpenAI, Anthropic, xAI, or local Ollama.",
  "You can always re-run this setup from Settings later.",
];

export function Welcome({ onNext }: Props): ReactNode {
  return (
    <Step className="items-center">
      <div className="mb-2 text-foreground">
        <LoomMark size={96} dur={2.6} loop />
      </div>
      <h1 className="text-center font-serif text-3xl font-medium tracking-tight text-foreground">
        Welcome to Loom
      </h1>
      <p className="text-center font-serif text-base/relaxed text-muted-foreground">
        A local-first memory system. Your notes live as plain markdown on disk —
        Loom's agents read and link them on your behalf.
      </p>
      <ul className="flex flex-col gap-2 self-stretch text-sm/relaxed text-secondary-foreground">
        {POINTS.map((point) => (
          <li key={point} className="flex items-start gap-2.5">
            <span
              aria-hidden="true"
              className="mt-2 size-1.5 shrink-0 rounded-full bg-brand"
            />
            {point}
          </li>
        ))}
      </ul>
      <StepActions className="self-stretch">
        <Button onClick={onNext}>Begin →</Button>
      </StepActions>
    </Step>
  );
}
