import type { ReactNode } from "react";
import { CheckCircle2, Plus, TestTube2, Trash2 } from "lucide-react";
import type { TestProviderResponse } from "../../api/types";
import { ModelCombobox } from "./ModelCombobox";
import type { ProviderForm, ProviderMeta } from "./providerModels";

interface Props {
  meta: ProviderMeta;
  provider?: ProviderForm;
  open: boolean;
  count: number;
  test?: TestProviderResponse;
  testing: boolean;
  onToggle: () => void;
  onAdd: () => void;
  onPatch: (patch: Partial<ProviderForm>) => void;
  onRemove: () => void;
  onTest: () => void;
}

export function ProviderAccordion(props: Props): ReactNode {
  const configured = Boolean(props.provider);
  const deleteDisabled = props.count <= 1;
  return (
    <article className="settings-provider-card">
      <button
        className="settings-provider-head"
        type="button"
        aria-expanded={props.open}
        onClick={props.onToggle}
      >
        <span>
          <strong>{props.meta.label}</strong>
          <small>{configured ? "Configured" : "Not configured"}</small>
        </span>
        {configured && <CheckCircle2 size={15} aria-hidden="true" />}
      </button>
      {props.open && (
        <div className="settings-provider-body">
          {props.provider ? (
            <ProviderFormFields
              {...props}
              provider={props.provider}
              deleteDisabled={deleteDisabled}
            />
          ) : (
            <button className="btn btn-md" type="button" onClick={props.onAdd}>
              <Plus size={14} aria-hidden="true" />
              Add provider
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function ProviderFormFields(
  props: Props & { provider: ProviderForm; deleteDisabled: boolean },
): ReactNode {
  return (
    <>
      {props.meta.name !== "ollama" && (
        <label className="settings-field">
          <span className="settings-field-label">API key</span>
          <input
            className="input mono"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={props.provider.apiKey}
            placeholder={props.provider.apiKeySet ? "Key is set" : "API key"}
            onChange={(e) => props.onPatch({ apiKey: e.target.value })}
          />
        </label>
      )}
      {props.meta.name === "ollama" && (
        <label className="settings-field">
          <span className="settings-field-label">Host</span>
          <input
            className="input mono"
            type="text"
            value={props.provider.host}
            placeholder={props.meta.defaultHost}
            onChange={(e) => props.onPatch({ host: e.target.value })}
          />
        </label>
      )}
      {props.meta.supportsBaseUrl && (
        <label className="settings-field">
          <span className="settings-field-label">API base URL</span>
          <input
            className="input mono"
            type="text"
            value={props.provider.baseUrl}
            placeholder={props.meta.defaultBaseUrl}
            onChange={(e) => props.onPatch({ baseUrl: e.target.value })}
          />
          <span className="settings-field-hint">
            Leave blank to use {props.meta.defaultBaseUrl}.
          </span>
        </label>
      )}
      <div className="settings-field-row">
        <ModelCombobox
          label="Chat model"
          value={props.provider.chatModel}
          options={props.meta.chatModels}
          onChange={(chatModel) => props.onPatch({ chatModel })}
        />
        <ModelCombobox
          label="Embed model"
          value={props.provider.embedModel}
          options={props.meta.embedModels}
          disabled={!props.meta.supportsEmbed}
          onChange={(embedModel) => props.onPatch({ embedModel })}
        />
      </div>
      <div className="settings-provider-actions">
        <button
          className="btn btn-md"
          type="button"
          onClick={props.onTest}
          disabled={props.testing}
        >
          <TestTube2 size={14} aria-hidden="true" />
          {props.testing ? "Testing…" : "Test"}
        </button>
        <button
          className="btn btn-md"
          type="button"
          onClick={props.onRemove}
          disabled={props.deleteDisabled}
          title={
            props.deleteDisabled
              ? "At least one provider must be configured."
              : undefined
          }
        >
          <Trash2 size={14} aria-hidden="true" />
          Delete
        </button>
        {props.deleteDisabled && (
          <span className="settings-hint">
            At least one provider must be configured.
          </span>
        )}
      </div>
      {props.test && (
        <div
          className={`settings-test-result ${props.test.ok ? "ok" : "fail"}`}
          role="status"
        >
          {props.test.ok
            ? `OK — ${props.test.latency_ms}ms`
            : `Failed — ${props.test.error ?? "unknown"}`}
        </div>
      )}
    </>
  );
}
