import { useState } from "react";
import type { ReactNode } from "react";

interface ConfirmModalProps {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
  /** Style the confirm button as destructive (amber). Defaults to true. */
  destructive?: boolean;
}

/**
 * A lightweight, keyboard- and screen-reader-accessible confirmation dialog.
 *
 * Reuses the settings-modal markup/classes (``role="dialog"``, ``aria-modal``,
 * Enter/Escape handling, busy/error states) but drops TypedConfirmModal's
 * typed-phrase gate — appropriate for ordinary confirmations like discarding
 * edits or archiving a note. A thrown ``onConfirm`` keeps the dialog open with
 * the error shown so the user can retry.
 */
export function ConfirmModal({
  title,
  body,
  confirmLabel,
  onConfirm,
  onClose,
  destructive = true,
}: ConfirmModalProps): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !busy) {
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
        aria-labelledby="confirm-modal-title"
        onKeyDown={onKeyDown}
      >
        <div className="settings-kicker">Confirm</div>
        <h2 id="confirm-modal-title" className="settings-modal-title">
          {title}
        </h2>
        <p className="settings-copy">{body}</p>
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
            autoFocus
          >
            Cancel
          </button>
          <button
            className={`btn btn-md ${destructive ? "btn-amber" : ""}`}
            type="button"
            disabled={busy}
            onClick={() => void confirm()}
          >
            {busy ? "Working…" : error ? "Retry" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
