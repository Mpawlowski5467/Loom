import { useState } from "react";
import type { ReactNode } from "react";
import type { Capture, NodeType } from "../data/types";
import {
  createNote,
  backendNoteToFrontend,
  type NoteRecord,
} from "../api/notes";

interface Props {
  capture: Capture;
  onClose: () => void;
  onAccepted: (note: ReturnType<typeof backendNoteToFrontend>, record: NoteRecord) => void;
}

const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "topic", label: "Topic" },
  { value: "project", label: "Project" },
  { value: "person", label: "Person" },
  { value: "daily", label: "Daily" },
  { value: "capture", label: "Capture" },
];

export function EditSuggestionModal({
  capture,
  onClose,
  onAccepted,
}: Props): ReactNode {
  const sug = capture.suggestion;
  const initialType: string = sug?.type === "people" ? "person" : sug?.type ?? "topic";
  const [title, setTitle] = useState(sug?.title ?? capture.title);
  const [type, setType] = useState(initialType);
  const [folder, setFolder] = useState(sug?.destFolder ?? capture.folder);
  const [tagsInput, setTagsInput] = useState((sug?.tags ?? []).join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedTitle = title.trim();
  const canSubmit = trimmedTitle.length > 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim().replace(/^#/, ""))
        .filter(Boolean);
      const record = await createNote({
        title: trimmedTitle,
        type,
        tags,
        folder,
        content: capture.body,
      });
      const frontend = backendNoteToFrontend(record);
      onAccepted(frontend, record);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
  };

  return (
    <div
      className="settings-modal-backdrop"
      role="presentation"
      onClick={onClose}
      onKeyDown={onKey}
    >
      <div
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-suggestion-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-kicker">Capture</div>
        <h2 id="edit-suggestion-title" className="settings-modal-title">
          Edit suggestion
        </h2>
        <p className="settings-copy">
          Override Weaver's classification before filing this capture. ⌘↵ to
          submit.
        </p>

        <label className="settings-field">
          <span className="settings-field-label">Title</span>
          <input
            className="input"
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={onKey}
          />
        </label>

        <div className="settings-field-row">
          <label className="settings-field">
            <span className="settings-field-label">Type</span>
            <select
              className="input mono"
              value={type}
              onChange={(e) => setType(e.target.value as NodeType)}
            >
              {TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-field">
            <span className="settings-field-label">Folder</span>
            <input
              className="input mono"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              onKeyDown={onKey}
            />
          </label>
        </div>

        <label className="settings-field">
          <span className="settings-field-label">Tags</span>
          <input
            className="input mono"
            value={tagsInput}
            placeholder="comma-separated, e.g. infra, perf"
            onChange={(e) => setTagsInput(e.target.value)}
            onKeyDown={onKey}
          />
        </label>

        {error && (
          <div className="settings-test-result fail" role="status">
            {error}
          </div>
        )}

        <div className="settings-actions">
          <button className="btn btn-md" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-md btn-active"
            type="button"
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {busy ? "Filing…" : "Accept & file"}
          </button>
        </div>
      </div>
    </div>
  );
}
