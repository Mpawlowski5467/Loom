import { useEffect, useRef, useState } from "react";
import type { Note, VaultGraph } from "../../lib/api";
import { archiveNote, fetchGraph, fetchNote } from "../../lib/api";
import { NoteEditor } from "./NoteEditor";
import styles from "./Sidebar.module.css";
import { ThreadView } from "./ThreadView";

interface SidebarProps {
  noteId: string | null;
  onClose: () => void;
  onNavigate: (noteId: string) => void;
  mode: "view" | "edit";
  onModeChange: (mode: "view" | "edit") => void;
  onToast: (message: string, variant?: "success" | "info" | "danger") => void;
}

export function Sidebar({
  noteId,
  onClose,
  onNavigate,
  mode,
  onModeChange,
  onToast,
}: SidebarProps) {
  const [note, setNote] = useState<Note | null>(null);
  const [graph, setGraph] = useState<VaultGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const fetchIdRef = useRef(0);

  // Derive: reset when noteId clears
  const [prevNoteId, setPrevNoteId] = useState<string | null>(null);
  if (noteId !== prevNoteId) {
    setPrevNoteId(noteId);
    if (!noteId) {
      setNote(null);
      onModeChange("view");
      setLoading(false);
    } else {
      setLoading(true);
    }
  }

  // Fetch note data
  useEffect(() => {
    if (!noteId) return;

    const id = ++fetchIdRef.current;
    Promise.all([fetchNote(noteId), fetchGraph()])
      .then(([n, g]) => {
        if (id !== fetchIdRef.current) return;
        setNote(n);
        setGraph(g);
        onModeChange("view");
        setLoading(false);
      })
      .catch((err) => {
        if (id !== fetchIdRef.current) return;
        console.error("Failed to load note:", err);
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  function handleNavigate(title: string) {
    if (!graph) return;
    const target = graph.nodes.find(
      (n) => n.title.toLowerCase() === title.toLowerCase(),
    );
    if (target) {
      onNavigate(target.id);
    }
  }

  function handleSaved(updated: Note) {
    setNote(updated);
    onModeChange("view");
    onToast(`Note "${updated.title}" saved`);
  }

  async function handleArchive() {
    if (!note) return;
    try {
      await archiveNote(note.id);
      onToast(`Note "${note.title}" archived`);
      onClose();
    } catch (err) {
      console.error("Archive failed:", err);
      onToast("Failed to archive note", "danger");
    }
  }

  const isOpen = noteId !== null;

  return (
    <div
      className={`${styles.sidebar}${isOpen ? ` ${styles.sidebarOpen}` : ""}${mode === "edit" && isOpen ? ` ${styles.sidebarEdit}` : ""}`}
    >
      {isOpen && (
        <>
          {/* Header */}
          <div className={styles.header}>
            {mode === "edit" && (
              <span className={styles.editBadge}>EDITING</span>
            )}
            <span className={styles.title}>{note?.title ?? ""}</span>

            {mode === "view" && note && (
              <>
                <button
                  className={`${styles.headerBtn} ${styles.headerBtnAmber}`}
                  onClick={() => onModeChange("edit")}
                >
                  Edit
                </button>
                <button
                  className={`${styles.headerBtn} ${styles.headerBtnDanger}`}
                  onClick={handleArchive}
                  title="Archive note"
                >
                  Archive
                </button>
              </>
            )}

            <button className={styles.closeBtn} onClick={onClose}>
              &#10005;
            </button>
          </div>

          {/* Loading skeleton */}
          {loading && (
            <div className={styles.body}>
              <div className={styles.skeleton}>
                <div className={styles.skeletonLine} style={{ width: "40%" }} />
                <div className={styles.skeletonLine} style={{ width: "60%" }} />
                <div className={styles.skeletonBlock} />
                <div className={styles.skeletonLine} style={{ width: "80%" }} />
                <div className={styles.skeletonLine} style={{ width: "50%" }} />
              </div>
            </div>
          )}

          {!loading && note && mode === "view" && (
            <div className={styles.body}>
              <ThreadView
                note={note}
                graph={graph}
                onNavigate={handleNavigate}
              />
            </div>
          )}

          {!loading && note && mode === "edit" && (
            <NoteEditor
              note={note}
              onSaved={handleSaved}
              onCancel={() => onModeChange("view")}
              onToast={onToast}
            />
          )}
        </>
      )}
    </div>
  );
}
