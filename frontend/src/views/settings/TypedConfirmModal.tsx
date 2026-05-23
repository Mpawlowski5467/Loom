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
  const matches = value === phrase;

  const confirm = async () => {
    if (!matches) return;
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-modal-backdrop" role="presentation">
      <div
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="typed-confirm-title"
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
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <div className="settings-actions">
          <button className="btn btn-md" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-md btn-amber"
            type="button"
            disabled={!matches || busy}
            onClick={() => void confirm()}
          >
            {busy ? "Working…" : destructiveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
