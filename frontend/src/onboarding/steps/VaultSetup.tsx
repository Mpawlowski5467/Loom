import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { vaultExists } from "../../api/vault";
import type { VaultExistsResponse } from "../../api/types";

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

type VaultMode = "create" | "adopt" | "reset";

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

  const setMode = (next: VaultMode) => {
    if (next === "reset") onChange({ overwriteExisting: true });
    else if (next === "adopt") onChange({ overwriteExisting: false });
    else onChange({ overwriteExisting: false });
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
    <div className="onb-step">
      <h2 className="onb-h2">Pick a vault</h2>
      <p className="onb-sub">
        Loom stores everything inside a vault folder. You can have many — start
        with the default for now.
      </p>

      <label className="onb-field">
        <span className="onb-field-label">Vault name</span>
        <input
          className="input"
          type="text"
          value={vaultName}
          onChange={(e) => onChange({ vaultName: e.target.value })}
          placeholder="default"
          autoFocus
        />
        <span className="onb-field-hint mono">
          Path: ~/.loom/vaults/{vaultName.trim() || "…"}
        </span>
      </label>

      {probing && <div className="onb-probe muted">Checking…</div>}
      {probeError && (
        <div className="onb-probe onb-probe-warn">{probeError}</div>
      )}

      {existingScaffolded && (
        <div className="onb-existing">
          <div className="onb-existing-h">We found an existing vault.</div>
          <div className="onb-existing-body">
            <label className="onb-radio">
              <input
                type="radio"
                name="vault-mode"
                checked={mode === "adopt"}
                onChange={() => setMode("adopt")}
              />
              <div>
                <div className="onb-radio-label">Adopt it</div>
                <div className="onb-radio-help">
                  Keep your notes, agents, and rules. Recommended.
                </div>
              </div>
            </label>
            <label className="onb-radio">
              <input
                type="radio"
                name="vault-mode"
                checked={mode === "reset"}
                onChange={() => setMode("reset")}
              />
              <div>
                <div className="onb-radio-label">Reset it</div>
                <div className="onb-radio-help">
                  Archive the existing vault to{" "}
                  <span className="mono">{vaultName}.archived-…</span> and start
                  fresh.
                </div>
              </div>
            </label>
            <label className="onb-radio">
              <input
                type="radio"
                name="vault-mode"
                checked={mode === "create"}
                onChange={() => onChange({ vaultName: "" })}
              />
              <div>
                <div className="onb-radio-label">Use a different name</div>
                <div className="onb-radio-help">
                  Clears the field above. Pick something unused.
                </div>
              </div>
            </label>
          </div>
          {mode === "reset" && (
            <div className="onb-warn">
              ⚠ Reset cannot be undone from the wizard — the old vault will be
              archived to a sibling folder but its files won't move back
              automatically.
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        className={`onb-demo ${seedDemo ? "active" : ""}`}
        onClick={toggleDemo}
        aria-pressed={seedDemo}
      >
        <Sparkles size={18} aria-hidden="true" />
        <span className="onb-demo-text">
          <span className="onb-demo-label">Try the demo vault</span>
          <span className="onb-demo-help">
            Seed this vault with example notes so you start on a populated graph
            instead of an empty one — explore it, then delete what you don't
            need.
          </span>
        </span>
        <span className="onb-demo-check mono">{seedDemo ? "On" : "Off"}</span>
      </button>

      <div className="onb-actions">
        <button className="btn btn-md" onClick={onBack}>
          ← Back
        </button>
        <button
          className="btn btn-md btn-active"
          onClick={onNext}
          disabled={!vaultName.trim()}
        >
          Next →
        </button>
      </div>
    </div>
  );
}
