import { useState } from "react";
import type { ReactNode } from "react";
import { useFocusTrap } from "../../components/useFocusTrap";
import {
  createCustomAgent,
  updateCustomAgent,
  type AgentRegistryRecord,
} from "../../api/agentsRegistry";
import { IconPicker } from "./IconPicker";
import { PromptField } from "./PromptField";
import { ModelOverrideField } from "./ModelOverrideField";

interface Props {
  existing?: AgentRegistryRecord;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

export function AddAgentModal({
  existing,
  onClose,
  onSaved,
}: Props): ReactNode {
  const [name, setName] = useState(existing?.name ?? "");
  const [role, setRole] = useState(existing?.role ?? "");
  const [icon, setIcon] = useState(existing?.icon ?? "✦");
  const [systemPrompt, setSystemPrompt] = useState(
    existing?.system_prompt ?? "",
  );
  const [provider, setProvider] = useState(existing?.provider ?? "");
  const [chatModel, setChatModel] = useState(existing?.chat_model ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Name input carries autoFocus; route Escape through the window-level trap.
  const dialogRef = useFocusTrap<HTMLDivElement>({
    onEscape: onClose,
    skipInitialFocus: true,
  });

  const canSubmit = name.trim().length > 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        role: role.trim(),
        icon: icon.trim() || "✦",
        system_prompt: systemPrompt,
        // Empty strings mean "use the vault default" on the backend.
        provider: provider.trim(),
        chat_model: chatModel.trim(),
      };
      if (existing) {
        await updateCustomAgent(existing.id, payload);
      } else {
        await createCustomAgent(payload);
      }
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    // Escape is handled by useFocusTrap at the window level.
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
  };

  return (
    <div
      className="settings-modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="settings-modal add-agent-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-agent-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-kicker">Agent</div>
        <h2 id="add-agent-title" className="settings-modal-title">
          {existing ? "Edit agent" : "Add agent"}
        </h2>
        <p className="settings-copy">
          Custom agents persist with your vault. Run one from its Board card and
          it gathers vault context, calls your chat provider with the
          instructions below, and writes a capture to your Inbox for triage.
        </p>

        <div className="settings-field-row add-agent-identity">
          <label className="settings-field">
            <span className="settings-field-label">Name</span>
            <input
              className="input"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={onKey}
            />
          </label>
          <div className="settings-field">
            <span className="settings-field-label">Icon</span>
            <IconPicker value={icon} onChange={setIcon} />
          </div>
        </div>

        <label className="settings-field">
          <span className="settings-field-label">Role</span>
          <input
            className="input"
            placeholder="what does this agent do?"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            onKeyDown={onKey}
          />
          <span className="settings-field-hint">
            One line shown on the agent's card — e.g. "digests my reading
            captures".
          </span>
        </label>

        <PromptField
          value={systemPrompt}
          onChange={setSystemPrompt}
          onKeyDown={onKey}
        />

        <ModelOverrideField
          provider={provider}
          chatModel={chatModel}
          onProviderChange={(next) => {
            setProvider(next);
            // A different provider invalidates the previous model choice.
            setChatModel("");
          }}
          onModelChange={setChatModel}
        />

        {error && (
          <div className="settings-test-result fail" role="status">
            {error}
          </div>
        )}

        <div className="settings-actions">
          <button className="btn btn-md" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-md btn-active"
            type="button"
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {busy ? "Saving…" : existing ? "Save" : "Add agent"}
          </button>
        </div>
      </div>
    </div>
  );
}
