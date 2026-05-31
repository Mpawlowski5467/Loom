import { useState } from "react";
import type { ReactNode } from "react";

interface Props {
  phrase: string;
  body: string;
  destructiveLabel: string;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}

export function TypedConfirmModal({
  phrase,
  body,
  destructiveLabel,
  onConfirm,
  onClose,
}: Props): ReactNode {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = value === phrase;

  const confirm = async () => {
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      // Only dismiss on success — a thrown onConfirm keeps the modal open
      // with the typed phrase intact so the user can retry.
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && matches && !busy) {
      e.preventDefault();
      void confirm();
    } else if (e.key === "Escape" && !busy) {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="settings-modal-backdrop" role="presentation">
      <div
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="typed-confirm-title"
        onKeyDown={onKeyDown}
      >
        <div className="settings-kicker">Confirm</div>
        <h2 id="typed-confirm-title" className="settings-modal-title">
          {destructiveLabel}
        </h2>
        <p className="settings-copy">{body}</p>
        <label className="settings-field">
          <span className="settings-field-label">Type {phrase}</span>
          <input
            className="input mono"
            value={value}
            autoFocus
            disabled={busy}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        {error && (
          <div className="settings-test-result fail" role="alert">
            {error}
          </div>
        )}
        <div className="settings-actions">
          <button
            className="btn btn-md"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="btn btn-md btn-amber"
            type="button"
            disabled={!matches || busy}
            onClick={() => void confirm()}
          >
            {busy ? "Working…" : error ? "Retry" : destructiveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
