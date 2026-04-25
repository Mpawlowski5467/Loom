import { X } from "lucide-react";
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
  const [error, setError] = useState<string | null>(null);
  const fetchIdRef = useRef(0);

  // Reset/refresh when noteId changes — moved from render body to useEffect
  // to avoid Strict-Mode double-render warnings.
  useEffect(() => {
    if (!noteId) {
      setNote(null);
      setError(null);
      setLoading(false);
      onModeChange("view");
      return;
    }

    setLoading(true);
    setError(null);

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
        setError(err instanceof Error ? err.message : "Failed to load note");
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  function handleNavigate(title: string) {
    if (!graph) return;
    const target = graph.nodes.find((n) => n.title.toLowerCase() === title.toLowerCase());
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
            {mode === "edit" && <span className={styles.editBadge}>EDITING</span>}
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
              <X size={16} />
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

          {!loading && error && (
            <div className={styles.body}>
              <div className={styles.errorState}>
                <p className={styles.errorText}>{error}</p>
                <button
                  className={styles.errorRetry}
                  onClick={() => {
                    setError(null);
                    setLoading(true);
                    const rid = ++fetchIdRef.current;
                    Promise.all([fetchNote(noteId!), fetchGraph()])
                      .then(([n, g]) => {
                        if (rid !== fetchIdRef.current) return;
                        setNote(n);
                        setGraph(g);
                        onModeChange("view");
                        setLoading(false);
                      })
                      .catch((e) => {
                        if (rid !== fetchIdRef.current) return;
                        setError(e instanceof Error ? e.message : "Failed to load note");
                        setLoading(false);
                      });
                  }}
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          {!loading && !error && note && mode === "view" && (
            <div className={styles.body}>
              <ThreadView note={note} graph={graph} onNavigate={handleNavigate} />
            </div>
          )}

          {!loading && !error && note && mode === "edit" && (
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
