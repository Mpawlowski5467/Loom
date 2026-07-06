import { useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { ModelCombobox } from "../settings/ModelCombobox";
import {
  PROVIDERS,
  PROVIDER_BY_NAME,
  type ProviderName,
} from "../settings/providerModels";

interface ModelOverrideFieldProps {
  provider: string;
  chatModel: string;
  onProviderChange: (provider: string) => void;
  onModelChange: (model: string) => void;
}

/**
 * Optional per-agent chat binding, collapsed behind a "Model" row. Empty
 * provider/model strings mean "use the vault default"; the model combobox
 * suggests the static catalog for the chosen provider but accepts free text.
 */
export function ModelOverrideField({
  provider,
  chatModel,
  onProviderChange,
  onModelChange,
}: ModelOverrideFieldProps): ReactNode {
  const [open, setOpen] = useState(Boolean(provider || chatModel));
  const meta = PROVIDER_BY_NAME.get(provider as ProviderName);
  const summary =
    provider || chatModel
      ? `${meta?.label ?? provider ?? "default provider"} · ${chatModel || "default model"}`
      : "vault default";

  return (
    <div className="model-override">
      <button
        type="button"
        className="model-override-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="settings-field-label">Model</span>
        <span className="model-override-summary">{summary}</span>
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={`model-override-chevron${open ? " is-open" : ""}`}
        />
      </button>
      {open && (
        <div className="settings-field-row model-override-body">
          <label className="settings-field">
            <span className="settings-field-label">Provider</span>
            <select
              className="input"
              value={provider}
              onChange={(e) => onProviderChange(e.target.value)}
            >
              <option value="">vault default</option>
              {PROVIDERS.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <ModelCombobox
            label="Chat model"
            value={chatModel}
            options={meta?.chatModels ?? []}
            onChange={onModelChange}
          />
        </div>
      )}
    </div>
  );
}
