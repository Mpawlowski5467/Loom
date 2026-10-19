import type { ReactNode } from "react";
import type { OnboardingProviderPayload } from "@/api/types";
import { ToggleCard } from "../../StepLayout";
import { PROVIDERS, type ProviderOption } from "./providerOptions";

interface ProviderPickerProps {
  providers: OnboardingProviderPayload[];
  onToggle: (opt: ProviderOption) => void;
}

/** One toggle card per provider, plus a nudge while none is picked. */
export function ProviderPicker({
  providers,
  onToggle,
}: ProviderPickerProps): ReactNode {
  return (
    <>
      <div
        className="grid gap-2 sm:grid-cols-2"
        role="group"
        aria-label="Provider"
      >
        {PROVIDERS.map((opt) => (
          <ToggleCard
            key={opt.name}
            pressed={providers.some((p) => p.name === opt.name)}
            onClick={() => onToggle(opt)}
            className="flex flex-col gap-1 px-3 py-2.5"
          >
            <span className="text-sm font-semibold">{opt.label}</span>
            <span className="text-xs wrap-break-word text-muted-foreground">
              {opt.hint}
            </span>
          </ToggleCard>
        ))}
      </div>

      {providers.length === 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border-strong px-4 py-3.5 text-sm/relaxed text-secondary-foreground">
          <p>
            Pick at least one provider above to unlock agents, search, and graph
            linking.
          </p>
          <p className="text-xs/relaxed text-muted-foreground">
            <strong>Chat</strong> powers the agents and Council;{" "}
            <strong>embed</strong> powers semantic search and link suggestions.
            They can be different providers — or Skip to stay fully local for
            now.
          </p>
        </div>
      )}
    </>
  );
}
