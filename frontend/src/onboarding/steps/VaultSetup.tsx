import { useEffect, useId, useState } from "react";
import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { vaultExists } from "@/api/vault";
import type { VaultExistsResponse } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Step, StepActions, StepHeader } from "../StepLayout";
import { DemoVaultToggle } from "./vault/DemoVaultToggle";
import {
  ExistingVaultOptions,
  type VaultMode,
} from "./vault/ExistingVaultOptions";

interface Props {
  vaultName: string;
  overwriteExisting: boolean;
  seedDemo: boolean;
  onChange: (patch: {
    vaultName?: string;
    overwriteExisting?: boolean;
    seedDemo?: boolean;
  }) => void;
  onNext: () => void;
  onBack: () => void;
}

export function VaultSetup({
  vaultName,
  overwriteExisting,
  seedDemo,
  onChange,
  onNext,
  onBack,
}: Props): ReactNode {
  const [probe, setProbe] = useState<VaultExistsResponse | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const inputId = useId();
  const hintId = useId();

  useEffect(() => {
    const trimmed = vaultName.trim();
    if (!trimmed) {
      // Reset state on next tick so the rule against sync setState in an
      // effect stays satisfied — we don't need a probe result for empty input.
      const id = setTimeout(() => {
        setProbe(null);
        setProbeError(null);
        setProbing(false);
      }, 0);
      return () => clearTimeout(id);
    }
    const ctrl = new AbortController();
    let live = true;
    const id = setTimeout(() => {
      if (!live) return;
      setProbing(true);
      setProbeError(null);
      vaultExists(trimmed, ctrl.signal)
        .then((res) => {
          if (!live) return;
          setProbe(res);
        })
        .catch((err) => {
          if (!live || ctrl.signal.aborted) return;
          setProbeError(err instanceof Error ? err.message : "Probe failed");
          setProbe(null);
        })
        .finally(() => {
          if (live && !ctrl.signal.aborted) setProbing(false);
        });
    }, 0);
    return () => {
      live = false;
      clearTimeout(id);
      ctrl.abort();
    };
  }, [vaultName]);

  const existingScaffolded = probe?.exists && probe.scaffolded;
  const mode: VaultMode = !existingScaffolded
    ? "create"
    : overwriteExisting
      ? "reset"
      : "adopt";

  // "Use a different name" clears the field rather than picking a mode.
  const selectMode = (next: VaultMode) => {
    if (next === "create") onChange({ vaultName: "" });
    else onChange({ overwriteExisting: next === "reset" });
  };

  const toggleDemo = () => {
    if (seedDemo) {
      onChange({ seedDemo: false });
      return;
    }
    // Suggest the "demo" name when the user hasn't picked a meaningful one.
    const trimmed = vaultName.trim();
    const patch: { seedDemo: boolean; vaultName?: string } = { seedDemo: true };
    if (!trimmed || trimmed === "default") patch.vaultName = "demo";
    onChange(patch);
  };

  return (
    <Step>
      <StepHeader
        title="Pick a vault"
        description="Loom stores everything inside a vault folder. You can have many — start with the default for now."
      />

      <Field id={inputId} label="Vault name">
        <Input
          id={inputId}
          type="text"
          value={vaultName}
          onChange={(e) => onChange({ vaultName: e.target.value })}
          placeholder="default"
          aria-describedby={hintId}
          autoFocus
        />
        <p
          id={hintId}
          className="font-mono text-xs wrap-break-word text-muted-foreground"
        >
          Path: ~/.loom/vaults/{vaultName.trim() || "…"}
        </p>
      </Field>

      {probing && (
        <p className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
          <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
          Checking…
        </p>
      )}
      {probeError && (
        <p className="font-mono text-xs text-warning-foreground">
          {probeError}
        </p>
      )}

      {existingScaffolded && (
        <ExistingVaultOptions
          vaultName={vaultName}
          mode={mode}
          onSelect={selectMode}
        />
      )}

      <DemoVaultToggle pressed={seedDemo} onToggle={toggleDemo} />

      <StepActions>
        <Button variant="ghost" onClick={onBack}>
          ← Back
        </Button>
        <Button onClick={onNext} disabled={!vaultName.trim()}>
          Next →
        </Button>
      </StepActions>
    </Step>
  );
}
