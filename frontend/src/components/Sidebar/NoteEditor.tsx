import { X } from "lucide-react";
import { useState } from "react";
import type { Note } from "../../lib/api";
import { updateNote } from "../../lib/api";
import { LoomPlateEditor } from "../../lib/editor";
import styles from "./NoteEditor.module.css";

const NOTE_TYPES = ["topic", "project", "person", "daily", "capture"];

interface NoteEditorProps {
  note: Note;
  onSaved: (updated: Note) => void;
  onCancel: () => void;
  onToast: (message: string, variant?: "success" | "info" | "danger") => void;
}

export function NoteEditor({ note, onSaved, onCancel, onToast }: NoteEditorProps) {
  const [body, setBody] = useState(note.body);
  const [tags, setTags] = useState<string[]>(note.tags);
  const [noteType, setNoteType] = useState(note.type);
  const [tagInput, setTagInput] = useState("");
  const [saving, setSaving] = useState(false);

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

  function handleRemoveTag(tag: string) {
    setTags(tags.filter((t) => t !== tag));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await updateNote(note.id, {
        body,
        tags,
        type: noteType,
      });
      onSaved(updated);
    } catch (err) {
      console.error("Save failed:", err);
      const msg = err instanceof Error ? err.message : "Save failed";
      onToast(msg, "danger");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* Meta fields */}
      <div className={styles.body}>
        <div className={styles.metaField}>
          <span className={styles.metaLabel}>Type</span>
          <select
            className={styles.metaSelect}
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

        <div className={styles.metaField}>
          <span className={styles.metaLabel}>Tags</span>
          <div className={styles.tagsWrap}>
            {tags.map((tag) => (
              <span
                key={tag}
                className={`${styles.tagChip} ${styles.tagChipRemovable}`}
                onClick={() => handleRemoveTag(tag)}
              >
                {tag} <X size={10} />
              </span>
            ))}
            <input
              className={styles.addTagInput}
              type="text"
              placeholder="+ add"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleAddTag}
            />
          </div>
        </div>

        {/* Plate rich text editor */}
        <LoomPlateEditor value={body} onChange={setBody} />
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        <button className={styles.footerBtn} onClick={onCancel}>
          Cancel
        </button>
        <button
          className={`${styles.footerBtn} ${styles.footerBtnAmber}`}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </>
  );
}
