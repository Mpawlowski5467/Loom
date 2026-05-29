import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { createNote, getTree, type NoteRecord } from "../api/notes";

interface Props {
  onClose: () => void;
  onCreated: (note: NoteRecord) => void;
  initialTitle?: string;
}

interface TypeOption {
  value: string;
  label: string;
  /** Backend folder this type lands in when "default" is selected. */
  defaultFolder: string;
}

const TYPE_OPTIONS: TypeOption[] = [
  { value: "topic", label: "Topic", defaultFolder: "topics" },
  { value: "project", label: "Project", defaultFolder: "projects" },
  { value: "person", label: "Person", defaultFolder: "people" },
  { value: "daily", label: "Daily", defaultFolder: "daily" },
  { value: "capture", label: "Capture", defaultFolder: "captures" },
];

// Sentinel value for "no override — use the type's default folder".
const FOLDER_AUTO = "__auto__";

export function NewNoteModal({
  onClose,
  onCreated,
  initialTitle,
}: Props): ReactNode {
  const [title, setTitle] = useState(initialTitle ?? "");
  const [type, setType] = useState<string>("topic");
  const [folder, setFolder] = useState<string>(FOLDER_AUTO);
  const [tagsInput, setTagsInput] = useState("");
  const [folders, setFolders] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getTree()
      .then((tree) => {
        if (cancelled) return;
        const dirs = (tree.children ?? [])
          .filter((c) => c.is_dir && !c.name.startsWith("."))
          .map((c) => c.name)
          .sort();
        setFolders(dirs);
      })
      .catch(() => {
        // Tree unreachable — fall back to type-default folder, no dropdown.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const trimmedTitle = title.trim();
  const canSubmit = trimmedTitle.length > 0 && !busy;
  const defaultFolderForType =
    TYPE_OPTIONS.find((t) => t.value === type)?.defaultFolder ?? "topics";

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim().replace(/^#/, ""))
        .filter(Boolean);
      const note = await createNote({
        title: trimmedTitle,
        type,
        tags,
        // FOLDER_AUTO → empty string → backend picks default for type.
        folder: folder === FOLDER_AUTO ? "" : folder,
      });
      onCreated(note);
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
        aria-labelledby="new-note-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-kicker">New note</div>
        <h2 id="new-note-title" className="settings-modal-title">
          Create a note
        </h2>
        <p className="settings-copy">
          Weaver will run the read-before-write chain and file it into the
          vault. ⌘↵ to submit.
        </p>

        <label className="settings-field">
          <span className="settings-field-label">Title</span>
          <input
            className="input"
            value={title}
            autoFocus
            placeholder="A short, declarative name"
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
            <select
              className="input mono"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
            >
              <option value={FOLDER_AUTO}>
                — default ({defaultFolderForType}) —
              </option>
              {folders.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
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
            {busy ? "Creating…" : "Create note"}
          </button>
        </div>
      </div>
    </div>
  );
}
