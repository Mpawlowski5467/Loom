import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import { ConfirmModal } from "@/components/ConfirmModal";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { EditorConflict } from "./useNoteDraft";

interface ConflictBannerProps {
  conflict: EditorConflict;
  draft: string;
  onKeep: () => void;
  onReload: () => void;
  onOverwrite: () => Promise<void>;
}

/** A newer remote version exists: compare, reload, keep, or overwrite. */
export function ConflictBanner({
  conflict,
  draft,
  onKeep,
  onReload,
  onOverwrite,
}: ConflictBannerProps) {
  const [comparing, setComparing] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  return (
    <>
      <Alert variant="warning" className="mb-6">
        <TriangleAlert aria-hidden="true" />
        <AlertTitle>Version conflict</AlertTitle>
        <AlertDescription className="text-warning-foreground">
          <p>{conflict.message}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="xs"
              variant="outline"
              onClick={() => setComparing(true)}
            >
              Compare
            </Button>
            <Button size="xs" variant="outline" onClick={onReload}>
              Reload remote
            </Button>
            <Button size="xs" variant="outline" onClick={onKeep}>
              Keep draft
            </Button>
            <Button
              size="xs"
              variant="destructive"
              onClick={() => setConfirmOverwrite(true)}
            >
              Overwrite remote
            </Button>
          </div>
        </AlertDescription>
      </Alert>
      <Dialog open={comparing} onOpenChange={setComparing}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Compare your draft with the newer note</DialogTitle>
            <DialogDescription>
              The remote version was saved {conflict.remoteModified}.
            </DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[60vh] gap-4 overflow-auto md:grid-cols-2">
            {[
              ["Your draft", draft],
              ["Remote version", conflict.remoteBody],
            ].map(([label, text]) => (
              <section key={label} className="min-w-0">
                <h3 className="mb-2 text-sm font-medium">{label}</h3>
                <pre className="rounded-md border border-border bg-muted p-3 font-mono text-xs whitespace-pre-wrap text-secondary-foreground">
                  {text}
                </pre>
              </section>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      {confirmOverwrite && (
        <ConfirmModal
          title="Overwrite the newer note version?"
          body="This replaces the remote body with your local draft."
          confirmLabel="Overwrite remote"
          destructive
          onConfirm={onOverwrite}
          onClose={() => setConfirmOverwrite(false)}
        />
      )}
    </>
  );
}
