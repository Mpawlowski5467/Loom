import { useId } from "react";
import type { ReactNode } from "react";
import type { OnboardingProviderPayload } from "@/api/types";
import { NativeSelect } from "@/components/ui/native-select";
import { Field } from "../../StepLayout";
import { providerMeta, type DraftPatch } from "./providerOptions";

interface ProviderDefaultsProps {
  providers: OnboardingProviderPayload[];
  chatProvider: string | null;
  embedProvider: string | null;
  onChange: (patch: DraftPatch) => void;
}

/** Which picked provider serves chat and which serves embeddings. */
export function ProviderDefaults({
  providers,
  chatProvider,
  embedProvider,
  onChange,
}: ProviderDefaultsProps): ReactNode {
  const id = useId();
  const options = providers.map((p) => (
    <option key={p.name} value={p.name}>
      {providerMeta(p.name)?.label ?? p.name}
    </option>
  ));
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border-strong p-4">
      <h3 className="text-sm font-semibold text-foreground">Defaults</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${id}-chat`} label="Chat provider">
          <NativeSelect
            id={`${id}-chat`}
            className="font-mono"
            value={chatProvider ?? ""}
            onChange={(e) => onChange({ chatProvider: e.target.value || null })}
          >
            {options}
          </NativeSelect>
        </Field>
        <Field id={`${id}-embed`} label="Embed provider">
          <NativeSelect
            id={`${id}-embed`}
            className="font-mono"
            value={embedProvider ?? ""}
            onChange={(e) =>
              onChange({ embedProvider: e.target.value || null })
            }
          >
            {options}
          </NativeSelect>
        </Field>
      </div>
    </div>
  );
}
