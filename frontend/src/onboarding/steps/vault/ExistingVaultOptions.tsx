import { useId } from "react";
import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

export type VaultMode = "create" | "adopt" | "reset";

interface ExistingVaultOptionsProps {
  vaultName: string;
  mode: VaultMode;
  onSelect: (mode: VaultMode) => void;
}

function ModeOption({
  value,
  title,
  children,
}: {
  value: VaultMode;
  title: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start gap-3 rounded-md p-2 transition-colors duration-150 ease-[cubic-bezier(.2,.7,.3,1)] hover:bg-accent"
    >
      <RadioGroupItem id={id} value={value} className="mt-0.5" />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{title}</span>
        <span className="text-xs/relaxed text-muted-foreground">
          {children}
        </span>
      </span>
    </label>
  );
}

/** Adopt, reset or rename when the chosen vault name already exists. */
export function ExistingVaultOptions({
  vaultName,
  mode,
  onSelect,
}: ExistingVaultOptionsProps): ReactNode {
  const headingId = useId();
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/50 p-4">
      <h3 id={headingId} className="text-sm font-semibold text-foreground">
        We found an existing vault.
      </h3>
      <RadioGroup
        aria-labelledby={headingId}
        value={mode}
        onValueChange={(next) => onSelect(next as VaultMode)}
        className="gap-1"
      >
        <ModeOption value="adopt" title="Adopt it">
          Keep your notes, agents, and rules. Recommended.
        </ModeOption>
        <ModeOption value="reset" title="Reset it">
          Archive the existing vault to{" "}
          <span className="font-mono wrap-break-word">
            {vaultName}.archived-…
          </span>{" "}
          and start fresh.
        </ModeOption>
        <ModeOption value="create" title="Use a different name">
          Clears the field above. Pick something unused.
        </ModeOption>
      </RadioGroup>
      {mode === "reset" && (
        <div className="flex items-start gap-2 rounded-md border border-warning-border bg-warning px-3 py-2 text-xs/relaxed text-warning-foreground">
          <TriangleAlert
            aria-hidden="true"
            className="mt-0.5 size-3.5 shrink-0"
          />
          <span>
            Reset cannot be undone from the wizard — the old vault will be
            archived to a sibling folder but its files won't move back
            automatically.
          </span>
        </div>
      )}
    </div>
  );
}
