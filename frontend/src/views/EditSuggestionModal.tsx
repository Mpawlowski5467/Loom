import { useState } from "react";
import type { ReactNode } from "react";
import type { Capture } from "../data/types";
import { useFocusTrap } from "../components/useFocusTrap";
import {
  captureRelPath,
  commitCapture,
  previewCapture,
  type CapturePreview,
  type CommitResult,
} from "../api/captures";

interface Props {
  capture: Capture;
  /** The already-fetched preview, used to prefill the form. */
  preview?: CapturePreview;
  onClose: () => void;
  onAccepted: (result: CommitResult) => void;
}

const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "topic", label: "Topic" },
  { value: "project", label: "Project" },
  { value: "person", label: "Person" },
  { value: "daily", label: "Daily" },
  { value: "capture", label: "Capture" },
];

/** The UI carries the frontend ``people``; the backend speaks ``person``. */
function toBackendType(t: string): string {
  return t === "people" ? "person" : t;
}

export function EditSuggestionModal({
  capture,
  preview,
  onClose,
  onAccepted,
}: Props): ReactNode {
  const sug = capture.suggestion;
  const initialType = toBackendType(preview?.note_type ?? sug?.type ?? "topic");
  const initialTitle = preview?.title ?? sug?.title ?? capture.title;
  const initialFolder = preview?.folder ?? sug?.destFolder ?? capture.folder;
  const initialTags = (preview?.tags ?? sug?.tags ?? []).join(", ");

  const [title, setTitle] = useState(initialTitle);
  const [type, setType] = useState(initialType);
  const [folder, setFolder] = useState(initialFolder);
  const [tagsInput, setTagsInput] = useState(initialTags);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedTitle = title.trim();
  const canSubmit = trimmedTitle.length > 0 && !busy;

  const dirty =
    title !== initialTitle ||
    type !== initialType ||
    folder !== initialFolder ||
    tagsInput !== initialTags;

  // Guard accidental dismissal (backdrop / Cancel / Esc) once edits exist.
  const requestClose = () => {
    if (dirty && !window.confirm("Discard your changes to this suggestion?")) {
      return;
    }
    onClose();
  };

  // Title input carries autoFocus; route Escape through the dirty-aware guard.
  const dialogRef = useFocusTrap<HTMLDivElement>({
    onEscape: requestClose,
    skipInitialFocus: true,
  });

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim().replace(/^#/, ""))
        .filter(Boolean);
      const path = captureRelPath(capture);
      // Re-preview with the edits so Weaver regenerates the body for the chosen
      // type, then file exactly what was regenerated (what-you-see-is-filed).
      const fresh = await previewCapture({
        capture_path: path,
        note_type: type,
        folder,
        title: trimmedTitle,
        tags,
      });
      if (!fresh) {
        setError("This capture is empty — nothing to file.");
        return;
      }
      const result = await commitCapture({
        capture_path: path,
        note_type: fresh.note_type,
        folder: fresh.folder,
        title: fresh.title,
        tags: fresh.tags,
        body: fresh.body,
      });
      onAccepted(result);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Filing failed");
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    // Escape is handled by useFocusTrap at the window level.
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
  };

  return (
    <div
      className="settings-modal-backdrop"
      role="presentation"
      onClick={requestClose}
    >
      <div
        ref={dialogRef}
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
          Override Weaver's classification before filing this capture. Weaver
          regenerates the note body for your chosen type. ⌘↵ to submit.
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
              onChange={(e) => setType(e.target.value)}
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
          <button className="btn btn-md" type="button" onClick={requestClose}>
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
