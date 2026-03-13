import { useCallback, useEffect, useRef, useState } from "react";
import type { Note, VaultGraph } from "../../lib/api";
import { fetchGraph, fetchNote } from "../../lib/api";
import { NoteEditor } from "./NoteEditor";
import styles from "./Sidebar.module.css";
import { ThreadView } from "./ThreadView";

interface SidebarProps {
  noteId: string | null;
  onClose: () => void;
  onNavigate: (noteId: string) => void;
}

export function Sidebar({ noteId, onClose, onNavigate }: SidebarProps) {
  const [note, setNote] = useState<Note | null>(null);
  const [graph, setGraph] = useState<VaultGraph | null>(null);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [loading, setLoading] = useState(false);
  const fetchIdRef = useRef(0);

  // Derive: reset when noteId clears
  const [prevNoteId, setPrevNoteId] = useState<string | null>(null);
  if (noteId !== prevNoteId) {
    setPrevNoteId(noteId);
    if (!noteId) {
      setNote(null);
      setMode("view");
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
        setMode("view");
        setLoading(false);
      })
      .catch((err) => {
        if (id !== fetchIdRef.current) return;
        console.error("Failed to load note:", err);
        setLoading(false);
      });
  }, [noteId]);

  const handleNavigate = useCallback(
    (title: string) => {
      if (!graph) return;
      const target = graph.nodes.find(
        (n) => n.title.toLowerCase() === title.toLowerCase(),
      );
      if (target) {
        onNavigate(target.id);
      }
    },
    [graph, onNavigate],
  );

  const handleSaved = useCallback((updated: Note) => {
    setNote(updated);
    setMode("view");
  }, []);

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

            {mode === "view" && (
              <button
                className={`${styles.headerBtn} ${styles.headerBtnAmber}`}
                onClick={() => setMode("edit")}
              >
                Edit
              </button>
            )}

            <button className={styles.closeBtn} onClick={onClose}>
              &#10005;
            </button>
          </div>

          {/* Content */}
          {loading && (
            <div className={styles.loadingMsg}>Loading note...</div>
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
              onCancel={() => setMode("view")}
            />
          )}
        </>
      )}
    </div>
  );
}
