import { X } from "lucide-react";
import { useState } from "react";
import type { Note } from "../../lib/api";
import { createNote } from "../../lib/api";
import styles from "./CreateNoteModal.module.css";

const NOTE_TYPES = ["topic", "project", "person", "daily", "capture"];
const FOLDERS = ["", "topics", "projects", "people", "daily", "captures"];

interface CreateNoteModalProps {
  onCreated: (note: Note) => void;
  onClose: () => void;
}

export function CreateNoteModal({ onCreated, onClose }: CreateNoteModalProps) {
  const [title, setTitle] = useState("");
  const [noteType, setNoteType] = useState("topic");
  const [folder, setFolder] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [content, setContent] = useState("");
  const [creating, setCreating] = useState(false);

  function handleAddTag(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && tagInput.trim()) {
      e.preventDefault();
      const t = tagInput.trim().toLowerCase();
      if (!tags.includes(t)) {
        setTags([...tags, t]);
      }
      setTagInput("");
    }
  }

  async function handleCreate() {
    if (!title.trim()) return;
    setCreating(true);
    try {
      const note = await createNote({
        title: title.trim(),
        type: noteType,
        tags,
        folder: folder || undefined,
        content: content || undefined,
      });
      onCreated(note);
    } catch (err) {
      console.error("Create failed:", err);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalTitle}>Create Note</div>

        <div className={styles.field}>
          <label className={styles.label}>Title</label>
          <input
            className={styles.input}
            type="text"
            placeholder="Note title..."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Type</label>
          <select
            className={styles.select}
            value={noteType}
            onChange={(e) => setNoteType(e.target.value)}
          >
            {NOTE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Folder</label>
          <select
            className={styles.select}
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
          >
            {FOLDERS.map((f) => (
              <option key={f} value={f}>
                {f || "(auto)"}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Tags</label>
          <div className={styles.tagsWrap}>
            {tags.map((tag) => (
              <span
                key={tag}
                className={styles.tagChip}
                onClick={() => setTags(tags.filter((t) => t !== tag))}
              >
                {tag} <X size={10} />
              </span>
            ))}
            <input
              className={styles.tagInput}
              type="text"
              placeholder="+ add tag"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleAddTag}
            />
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Content (optional)</label>
          <textarea
            className={styles.textarea}
            placeholder="Initial markdown content..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </div>

        <div className={styles.hint}>
          Weaver will read prime.md &rarr; apply schema &rarr; create note
        </div>

        <div className={styles.footer}>
          <button className={styles.btn} onClick={onClose}>
            Cancel
          </button>
          <button
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={handleCreate}
            disabled={creating || !title.trim()}
          >
            {creating ? "Creating..." : "Create Note"}
          </button>
        </div>
      </div>
    </div>
  );
}
