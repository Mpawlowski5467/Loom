import { useState } from "react";
import {
  previewUndoRun,
  undoRun,
  type RunChangePreview,
} from "../api/revisions";
import { TextDiff } from "./TextDiff";
import { ConfirmModal } from "./ConfirmModal";
import { Button } from "./ui/button";

export function RunUndo({
  runId,
  disabled = false,
}: {
  runId: string;
  disabled?: boolean;
}) {
  const [preview, setPreview] = useState<RunChangePreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [undone, setUndone] = useState(false);
  return (
    <div className="flex flex-col gap-2 px-3 pb-3">
      <Button
        variant="outline"
        size="xs"
        className="self-start"
        disabled={busy || disabled || undone}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            setPreview(await previewUndoRun(runId));
          } catch (err) {
            setError(
              err instanceof Error ? err.message : "Could not preview undo",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {undone ? "Run undone" : "Preview undo of vault changes"}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-danger-foreground">
          {error}
        </p>
      )}
      {preview && !undone && (
        <div className="flex flex-col gap-2 rounded-md border border-border p-2 text-xs text-secondary-foreground">
          <p>
            {preview.files.length} affected files. New notes will move to the
            archive. Existing notes and source captures will return to their
            earlier versions.
          </p>
          {preview.conflicts.length > 0 && (
            <p role="alert" className="text-danger-foreground">
              Undo blocked: changed since this run:{" "}
              {preview.conflicts.join(", ")}
            </p>
          )}
          {preview.files.map((file) => (
            <details key={file.path}>
              <summary className="cursor-pointer font-mono">
                {file.path}
                {file.conflict ? " · conflict" : ""}
              </summary>
              <TextDiff before={file.after ?? ""} after={file.before ?? ""} />
            </details>
          ))}
          <Button
            variant="outline"
            size="xs"
            className="self-start"
            disabled={
              disabled || preview.conflicts.length > 0 || !preview.files.length
            }
            onClick={() => setConfirm(true)}
          >
            Undo all vault changes in this run
          </Button>
        </div>
      )}
      {confirm && preview && (
        <ConfirmModal
          title="Undo this run?"
          body={`Restore all ${preview.files.length} affected files as previewed. New notes remain recoverable in the archive. If any file changes, the whole operation will be blocked.`}
          confirmLabel="Undo run"
          onClose={() => setConfirm(false)}
          onConfirm={async () => {
            await undoRun(
              runId,
              Object.fromEntries(
                preview.files.map((file) => [file.path, file.current_hash]),
              ),
            );
            setUndone(true);
            setPreview(null);
          }}
        />
      )}
    </div>
  );
}
