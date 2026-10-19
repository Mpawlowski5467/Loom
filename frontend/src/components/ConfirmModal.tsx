import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ConfirmModalProps {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
  /** Style the confirm button as destructive. Defaults to true. */
  destructive?: boolean;
}

/**
 * A confirmation dialog for ordinary actions (discard edits, archive a note,
 * undo a commit). Enter confirms and Escape cancels unless it's working; a
 * thrown `onConfirm` keeps it open with the error so the user can retry.
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

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        aria-modal="true"
        showCloseButton={false}
        className="sm:max-w-md"
        onKeyDown={(e) => {
          if (e.key !== "Enter" || busy) return;
          e.preventDefault();
          void confirm();
        }}
        onEscapeKeyDown={(e) => busy && e.preventDefault()}
        onInteractOutside={(e) => busy && e.preventDefault()}
        onOpenAutoFocus={(e) => {
          // Cancel is the safe default focus.
          e.preventDefault();
          (e.currentTarget as HTMLElement)
            .querySelector<HTMLButtonElement>("[data-cancel]")
            ?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-danger-foreground">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            data-cancel
            variant="outline"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            className={destructive ? "border border-border" : undefined}
            disabled={busy}
            onClick={() => void confirm()}
          >
            {busy ? "Working…" : error ? "Retry" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
