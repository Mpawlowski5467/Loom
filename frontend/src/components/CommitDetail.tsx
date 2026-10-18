import { useEffect, useState } from "react";
import {
  getCommitDiff,
  revertCommit,
  type HistoryDiff,
  type RevertResult,
} from "../api/history";
import { ConfirmModal } from "./ConfirmModal";
import { Button } from "./ui/button";
import { TextDiff } from "./TextDiff";

interface CommitDetailProps {
  sha: string;
  /** Disable undo (e.g. while the note has an unsaved draft). */
  disabled?: boolean;
  onReverted?: (result: RevertResult) => void;
}

/** One history commit: who/why, Sentinel's verdict, per-file diffs, and undo. */
export function CommitDetail({
  sha,
  disabled = false,
  onReverted,
}: CommitDetailProps) {
  const [diff, setDiff] = useState<HistoryDiff | null>(null);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState<RevertResult | null>(null);

  // Callers key this component by sha, so state starts fresh per commit.
  useEffect(() => {
    let cancelled = false;
    void getCommitDiff(sha)
      .then((data) => {
        if (!cancelled) setDiff(data);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : "Could not load this change",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [sha]);

  if (error)
    return (
      <p role="alert" className="text-sm text-danger-foreground">
        {error}
      </p>
    );
  if (!diff)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading change…
      </p>
    );
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
      <div className="text-sm">
        <p className="font-medium text-foreground">{diff.subject}</p>
        <p className="font-mono text-xs text-muted-foreground">
          {diff.agents.join(", ")} · {new Date(diff.date).toLocaleString()} ·{" "}
          {diff.short_sha}
          {diff.sentinel && <> · Sentinel: {diff.sentinel}</>}
        </p>
      </div>
      {diff.reason && (
        <p className="text-sm text-secondary-foreground">{diff.reason}</p>
      )}
      {diff.file_diffs.map((file) => (
        <section key={file.path} className="flex flex-col gap-1">
          <h4 className="font-mono text-xs text-secondary-foreground">
            {file.path}{" "}
            <span className="text-muted-foreground">{file.status}</span>
          </h4>
          <TextDiff before={file.before ?? ""} after={file.after ?? ""} />
          {file.truncated && (
            <p className="text-xs text-muted-foreground">
              Large file: showing the first 200 KB.
            </p>
          )}
        </section>
      ))}
      {diff.files_truncated && (
        <p className="text-xs text-muted-foreground">
          Only the first 100 files are shown.
        </p>
      )}
      {done ? (
        <p role="status" className="text-sm text-ok-foreground">
          Undone in commit{" "}
          <code className="font-mono">{done.sha?.slice(0, 10) ?? "—"}</code>{" "}
          (Sentinel: {done.sentinel.status}).
        </p>
      ) : (
        diff.revertible && (
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            disabled={disabled}
            onClick={() => setConfirm(true)}
          >
            Undo this change
          </Button>
        )
      )}
      {confirm && (
        <ConfirmModal
          title="Undo this change?"
          body="Loom adds a new commit that reverses it; nothing is erased from history. Sentinel checks the result first, and newer overlapping edits block the undo."
          confirmLabel="Undo change"
          onClose={() => setConfirm(false)}
          onConfirm={async () => {
            const result = await revertCommit(diff.sha);
            setDone(result);
            onReverted?.(result);
          }}
        />
      )}
    </div>
  );
}
