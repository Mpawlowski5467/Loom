import { useState } from "react";
import {
  previewUndoRun,
  undoRun,
  type RunChangePreview,
} from "../api/revisions";
import { TextDiff } from "./TextDiff";
import { ConfirmModal } from "./ConfirmModal";

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
    <div className="run-undo">
      <button
        className="btn btn-sm"
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
      </button>
      {error && <p role="alert">{error}</p>}
      {preview && !undone && (
        <div className="revision-panel">
          <p>
            {preview.files.length} affected files. New notes will move to the
            archive. Existing notes and source captures will return to their
            earlier versions.
          </p>
          {preview.conflicts.length > 0 && (
            <p role="alert">
              Undo blocked: changed since this run:{" "}
              {preview.conflicts.join(", ")}
            </p>
          )}
          {preview.files.map((file) => (
            <details key={file.path}>
              <summary>
                {file.path}
                {file.conflict ? " · conflict" : ""}
              </summary>
              <TextDiff before={file.after ?? ""} after={file.before ?? ""} />
            </details>
          ))}
          <button
            className="btn btn-sm"
            disabled={
              disabled || preview.conflicts.length > 0 || !preview.files.length
            }
            onClick={() => setConfirm(true)}
          >
            Undo all vault changes in this run
          </button>
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
