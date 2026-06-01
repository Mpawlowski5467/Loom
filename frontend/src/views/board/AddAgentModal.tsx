import { useState } from "react";
import type { ReactNode } from "react";
import {
  createCustomAgent,
  updateCustomAgent,
  type AgentRegistryRecord,
} from "../../api/agentsRegistry";

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    if (e.key === "Escape") onClose();
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
  };

  return (
    <div
      className="settings-modal-backdrop"
      role="presentation"
      onClick={onClose}
      onKeyDown={onKey}
    >
      <div
        className="settings-modal"
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
          it gathers vault context, calls your chat provider with the system
          prompt below, and writes a capture to your Inbox for triage.
        </p>

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

        <div className="settings-field-row">
          <label className="settings-field">
            <span className="settings-field-label">Role</span>
            <input
              className="input"
              placeholder="what does this agent do?"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              onKeyDown={onKey}
            />
          </label>
          <label className="settings-field" style={{ maxWidth: 100 }}>
            <span className="settings-field-label">Icon</span>
            <input
              className="input mono"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              onKeyDown={onKey}
              maxLength={4}
            />
          </label>
        </div>

        <label className="settings-field">
          <span className="settings-field-label">System prompt</span>
          <textarea
            className="input"
            value={systemPrompt}
            rows={6}
            placeholder="You are…"
            onChange={(e) => setSystemPrompt(e.target.value)}
          />
        </label>

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
