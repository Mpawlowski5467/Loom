import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  createNote,
  getTree,
  type NoteRecord,
  type TreeNode,
} from "../api/notes";
import { useFocusTrap } from "../components/useFocusTrap";

interface Props {
  onClose: () => void;
  onCreated: (note: NoteRecord) => void;
  initialTitle?: string;
}

interface TypeOption {
  value: string;
  label: string;
  /** Backend folder this type lands in when "auto" is selected. */
  defaultFolder: string;
  /** Dot swatch suffix — the backend type is "person" but the palette class
   * is `dot-people`, so the two can't be derived from each other. */
  dot: string;
}

const TYPE_OPTIONS: TypeOption[] = [
  { value: "topic", label: "Topic", defaultFolder: "topics", dot: "topic" },
  { value: "project", label: "Project", defaultFolder: "projects", dot: "project" },
  { value: "person", label: "Person", defaultFolder: "people", dot: "people" },
  { value: "daily", label: "Daily", defaultFolder: "daily", dot: "daily" },
  { value: "capture", label: "Capture", defaultFolder: "captures", dot: "capture" },
];

// Sentinel value for "no override — use the type's default folder".
const FOLDER_AUTO = "__auto__";

/** Depth-first folder paths (nested included, alpha per level, dot-dirs out). */
function collectFolderPaths(node: TreeNode, prefix = ""): string[] {
  const dirs = (node.children ?? [])
    .filter((c) => c.is_dir && !c.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name));
  const out: string[] = [];
  for (const child of dirs) {
    const path = prefix ? `${prefix}/${child.name}` : child.name;
    out.push(path, ...collectFolderPaths(child, path));
  }
  return out;
}

function cleanTag(raw: string): string {
  return raw.trim().replace(/^#/, "");
}

interface TagEditorProps {
  tags: string[];
  draft: string;
  onDraftChange: (value: string) => void;
  onCommit: () => void;
  onRemove: (tag: string) => void;
  onRemoveLast: () => void;
}

function TagEditor({
  tags,
  draft,
  onDraftChange,
  onCommit,
  onRemove,
  onRemoveLast,
}: TagEditorProps): ReactNode {
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Plain Enter / comma commits a chip; ⌘/Ctrl+Enter bubbles up to submit.
    if ((e.key === "Enter" || e.key === ",") && !(e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onCommit();
    } else if (e.key === "Backspace" && draft === "" && tags.length > 0) {
      e.preventDefault();
      onRemoveLast();
    }
  };

  return (
    <div className="note-modal-tags">
      {tags.map((t) => (
        <span key={t} className="note-modal-tag-chip">
          #{t}
          <button
            type="button"
            className="note-modal-tag-remove"
            aria-label={`Remove tag ${t}`}
            onClick={() => onRemove(t)}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className="note-modal-tag-input"
        aria-label="Tags"
        value={draft}
        placeholder={tags.length === 0 ? "type a tag, Enter to add" : ""}
        onChange={(e) => onDraftChange(e.target.value)}
        onKeyDown={onKey}
      />
    </div>
  );
}

export function NewNoteModal({
  onClose,
  onCreated,
  initialTitle,
}: Props): ReactNode {
  const [title, setTitle] = useState(initialTitle ?? "");
  const [type, setType] = useState<string>("topic");
  const [folder, setFolder] = useState<string>(FOLDER_AUTO);
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [folders, setFolders] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Title input carries autoFocus, so skip the hook's initial focus.
  const dialogRef = useFocusTrap<HTMLDivElement>({
    onEscape: onClose,
    skipInitialFocus: true,
  });

  useEffect(() => {
    let cancelled = false;
    getTree()
      .then((tree) => {
        if (!cancelled) setFolders(collectFolderPaths(tree));
      })
      .catch(() => {
        // Tree unreachable — fall back to type-default folder, no options.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const trimmedTitle = title.trim();
  const canSubmit = trimmedTitle.length > 0 && !busy;
  const defaultFolderForType =
    TYPE_OPTIONS.find((t) => t.value === type)?.defaultFolder ?? "topics";

  const commitTag = () => {
    const t = cleanTag(tagDraft);
    if (t && !tags.includes(t)) setTags((prev) => [...prev, t]);
    setTagDraft("");
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      // A tag still sitting in the draft box counts — ⌘↵ mustn't drop it.
      const draft = cleanTag(tagDraft);
      const allTags = draft && !tags.includes(draft) ? [...tags, draft] : tags;
      const note = await createNote({
        title: trimmedTitle,
        type,
        tags: allTags,
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

  const onDialogKey = (e: React.KeyboardEvent) => {
    // Escape is handled by useFocusTrap at the window level.
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div className="note-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        className="note-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-note-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onDialogKey}
      >
        <header>
          <div className="note-modal-kicker">New note</div>
          <h2 id="new-note-title" className="note-modal-title">
            Create a note
          </h2>
        </header>

        <label className="note-modal-field">
          <span className="note-modal-label">Title</span>
          <input
            className="input"
            value={title}
            autoFocus
            placeholder="A short, declarative name"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>

        <div className="note-modal-field">
          <span className="note-modal-label" id="new-note-type-label">
            Type
          </span>
          <div
            className="note-modal-types"
            role="radiogroup"
            aria-labelledby="new-note-type-label"
          >
            {TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={type === opt.value}
                className="note-modal-type"
                onClick={() => setType(opt.value)}
              >
                <span className={`dot dot-${opt.dot}`} aria-hidden="true" />
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <label className="note-modal-field">
          <span className="note-modal-label">Folder</span>
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

        <div className="note-modal-field">
          <span className="note-modal-label">Tags</span>
          <TagEditor
            tags={tags}
            draft={tagDraft}
            onDraftChange={setTagDraft}
            onCommit={commitTag}
            onRemove={(t) => setTags((prev) => prev.filter((x) => x !== t))}
            onRemoveLast={() => setTags((prev) => prev.slice(0, -1))}
          />
        </div>

        {error && (
          <div className="note-modal-error" role="status">
            {error}
          </div>
        )}

        <div className="note-modal-actions">
          <p className="note-modal-hint">
            Weaver files it into the vault — ⌘↵ to create.
          </p>
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
