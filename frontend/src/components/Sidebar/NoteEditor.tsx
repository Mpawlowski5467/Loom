import { CheckSquare, X } from "lucide-react";
import { useRef, useState } from "react";
import type { Note } from "../../lib/api";
import { updateNote } from "../../lib/api";
import styles from "./NoteEditor.module.css";

const NOTE_TYPES = ["topic", "project", "person", "daily", "capture"];

interface NoteEditorProps {
  note: Note;
  onSaved: (updated: Note) => void;
  onCancel: () => void;
  onToast: (message: string, variant?: "success" | "info" | "danger") => void;
}

function insertMarkdown(
  textarea: HTMLTextAreaElement,
  before: string,
  after: string,
  setText: (v: string) => void,
) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const val = textarea.value;
  const selected = val.slice(start, end);
  const replacement = `${before}${selected || "text"}${after}`;
  const next = val.slice(0, start) + replacement + val.slice(end);
  setText(next);
  // Restore cursor after React re-renders
  requestAnimationFrame(() => {
    textarea.focus();
    const cursor = start + before.length;
    textarea.setSelectionRange(cursor, cursor + (selected.length || 4));
  });
}

export function NoteEditor({ note, onSaved, onCancel, onToast }: NoteEditorProps) {
  const [body, setBody] = useState(note.body);
  const [tags, setTags] = useState<string[]>(note.tags);
  const [noteType, setNoteType] = useState(note.type);
  const [tagInput, setTagInput] = useState("");
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleToolbar(before: string, after: string) {
    if (!textareaRef.current) return;
    insertMarkdown(textareaRef.current, before, after, setBody);
  }

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
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <button
          className={styles.toolBtn}
          title="Bold"
          onClick={() => handleToolbar("**", "**")}
        >
          B
        </button>
        <button
          className={styles.toolBtn}
          title="Italic"
          style={{ fontStyle: "italic" }}
          onClick={() => handleToolbar("*", "*")}
        >
          I
        </button>
        <button
          className={styles.toolBtn}
          title="Strikethrough"
          style={{ textDecoration: "line-through" }}
          onClick={() => handleToolbar("~~", "~~")}
        >
          S
        </button>
        <button
          className={styles.toolBtn}
          title="Code"
          onClick={() => handleToolbar("`", "`")}
        >
          {"{}"}
        </button>

        <span className={styles.toolDivider} />

        <button
          className={styles.toolBtn}
          title="Heading 1"
          onClick={() => handleToolbar("# ", "")}
        >
          H1
        </button>
        <button
          className={styles.toolBtn}
          title="Heading 2"
          onClick={() => handleToolbar("## ", "")}
        >
          H2
        </button>
        <button
          className={styles.toolBtn}
          title="Heading 3"
          onClick={() => handleToolbar("### ", "")}
        >
          H3
        </button>

        <span className={styles.toolDivider} />

        <button
          className={styles.toolBtn}
          title="Bullet list"
          onClick={() => handleToolbar("- ", "")}
        >
          &bull;
        </button>
        <button
          className={styles.toolBtn}
          title="Numbered list"
          onClick={() => handleToolbar("1. ", "")}
        >
          1.
        </button>
        <button
          className={styles.toolBtn}
          title="Checkbox"
          onClick={() => handleToolbar("- [ ] ", "")}
        >
          <CheckSquare size={14} />
        </button>

        <span className={styles.toolDivider} />

        <button
          className={`${styles.toolBtn} ${styles.toolBtnWikilink}`}
          title="Insert wikilink"
          onClick={() => handleToolbar("[[", "]]")}
        >
          [[link]]
        </button>
      </div>

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

        {/* Textarea editor */}
        <textarea
          ref={textareaRef}
          className={styles.editorTextarea}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
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
