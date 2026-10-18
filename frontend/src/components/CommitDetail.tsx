import { useEffect, useState } from "react";
import {
  getCommitDiff,
  revertCommit,
  type HistoryDiff,
  type RevertResult,
} from "../api/history";
import { ConfirmModal } from "./ConfirmModal";
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

  if (error) return <p role="alert">{error}</p>;
  if (!diff) return <p role="status">Loading change…</p>;
  return (
    <div className="commit-detail">
      <p className="commit-meta">
        <strong>{diff.subject}</strong>
        <br />
        {diff.agents.join(", ")} · {new Date(diff.date).toLocaleString()} ·{" "}
        <code>{diff.short_sha}</code>
        {diff.sentinel && <> · Sentinel: {diff.sentinel}</>}
      </p>
      {diff.reason && <p className="commit-reason">{diff.reason}</p>}
      {diff.file_diffs.map((file) => (
        <section key={file.path}>
          <h4>
            {file.path}{" "}
            <span className="commit-file-status">{file.status}</span>
          </h4>
          <TextDiff before={file.before ?? ""} after={file.after ?? ""} />
          {file.truncated && <p>Large file: showing the first 200 KB.</p>}
        </section>
      ))}
      {diff.files_truncated && <p>Only the first 100 files are shown.</p>}
      {done ? (
        <p role="status">
          Undone in commit <code>{done.sha?.slice(0, 10) ?? "—"}</code>{" "}
          (Sentinel: {done.sentinel.status}).
        </p>
      ) : (
        diff.revertible && (
          <button
            className="btn btn-sm"
            disabled={disabled}
            onClick={() => setConfirm(true)}
          >
            Undo this change
          </button>
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
