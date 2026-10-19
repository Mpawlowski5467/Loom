import { useState } from "react";
import { describeApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Note } from "@/data/types";

interface SpiderConfirmProps {
  note: Note;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

/** Spider writes links, so running it from the palette asks first. */
export function SpiderConfirm({
  note,
  onConfirm,
  onClose,
}: SpiderConfirmProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(describeApiError(err, "Spider couldn't run"));
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Run Spider on {note.title}?</DialogTitle>
          <DialogDescription>
            Spider looks for related notes and adds links for strong matches;
            weaker ones become suggestions. Each link it writes is a commit you
            can undo.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-danger-foreground">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button autoFocus onClick={() => void run()} disabled={busy}>
            {busy ? "Running…" : "Run Spider"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
