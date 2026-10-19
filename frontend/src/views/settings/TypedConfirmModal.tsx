import { useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "./kit/Field";
import { describeApiError } from "@/api/client";

interface Props {
  phrase: string;
  body: string;
  destructiveLabel: string;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}

/**
 * A confirmation for destructive vault actions, gated on typing `phrase`
 * exactly. Enter confirms once it matches; Escape and Cancel close unless
 * it's working. Outside clicks never dismiss it.
 */
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
      setError(describeApiError(err, "Action failed."));
      setBusy(false);
    }
  };

  // The phrase input is the first focusable element, so the dialog's
  // default open focus lands there.
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        aria-modal="true"
        showCloseButton={false}
        className="sm:max-w-md"
        onKeyDown={(e) => {
          if (e.key !== "Enter" || !matches || busy) return;
          e.preventDefault();
          void confirm();
        }}
        onEscapeKeyDown={(e) => busy && e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{destructiveLabel}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <Field
          label={
            <>
              Type <span className="font-mono">{phrase}</span>
            </>
          }
        >
          <Input
            className="font-mono"
            value={value}
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
        {error && (
          <p role="alert" className="text-sm text-danger-foreground">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            className="border border-danger-foreground/40"
            disabled={!matches || busy}
            onClick={() => void confirm()}
          >
            {busy ? "Working…" : error ? "Retry" : destructiveLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
