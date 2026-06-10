import { useEffect, useState } from "react";
import type { RefObject } from "react";
import type { Note } from "../../../data/types";
import { useApp } from "../../../context/app-ctx";
import {
  archiveTreePath,
  createFolder,
  moveTreePath,
  notePathOf,
  renameTreePath,
} from "../../../api/notes";
import { ApiError } from "../../../api/client";
import {
  DRAG_MIME,
  FOLDER_NAME_RE,
  SAFE_NAME_RE,
  type TreeInteraction,
} from "./treeModel";

/**
 * Drop archived note(s) from app state after a successful ``archiveTreePath``.
 *
 * Tree paths are relative to ``threads/`` — the same form ``notePathOf`` yields
 * — so resolution matches on that. A file archive comes with the exact
 * ``noteId`` from the context menu (the most reliable signal); a folder archive
 * has no id, so every note whose path sits under ``<path>/`` is removed.
 *
 * @returns the ids that were removed, so the caller can react when the active
 *   note was one of them.
 */
function removeArchivedNotes(
  notes: Note[],
  path: string,
  noteId: string | undefined,
  removeNote: (id: string) => void,
): Set<string> {
  const removed = new Set<string>();

  // File archive: trust the explicit id, falling back to a path match for
  // robustness (e.g. an id that no longer resolves cleanly).
  if (noteId) {
    removed.add(noteId);
  } else {
    const direct = notes.find((n) => notePathOf(n) === path);
    if (direct) removed.add(direct.id);
  }

  // Folder archive: every note whose path is within the archived folder.
  const prefix = `${path}/`;
  for (const note of notes) {
    if (notePathOf(note).startsWith(prefix)) removed.add(note.id);
  }

  for (const id of removed) removeNote(id);
  return removed;
}

/**
 * All the imperative tree interactions — new folder, drag-to-move, and the
 * context menu's rename / archive — plus their shared transient state. Kept out
 * of the Tree component so the view stays focused on rendering.
 */
export function useTreeActions(inputRef: RefObject<HTMLInputElement | null>) {
  const {
    notes,
    currentNoteId,
    addFolder,
    pushToast,
    updateNote,
    removeNote,
    setTab,
  } = useApp();

  // New-folder flow.
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Drag & drop.
  const [dragSource, setDragSource] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // A single interaction: context menu OR inline rename, never both.
  const [interaction, setInteraction] = useState<TreeInteraction>(null);

  // Close the context menu on any outside click / scroll.
  useEffect(() => {
    if (interaction?.kind !== "menu") return;
    const close = () => setInteraction(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [interaction]);

  // --- new folder ----------------------------------------------------------
  const startCreate = () => {
    setCreating(true);
    setDraft("");
    setError(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  };
  const cancelCreate = () => {
    setCreating(false);
    setDraft("");
    setError(null);
  };
  const submitCreate = async () => {
    const name = draft.trim();
    if (!name) return setError("Name required");
    if (!FOLDER_NAME_RE.test(name)) {
      return setError("Letters, digits, dashes, underscores; '/' for nesting");
    }
    setBusy(true);
    setError(null);
    try {
      await createFolder(name);
      addFolder(name);
      pushToast({ icon: "📁", agent: "archivist", body: `Created folder ${name}/` });
      cancelCreate();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409)
        setError("Folder already exists");
      else setError(err instanceof Error ? err.message : "Failed to create folder");
    } finally {
      setBusy(false);
    }
  };

  // --- drag & drop ---------------------------------------------------------
  const handleDragStart = (e: React.DragEvent, path: string) => {
    e.dataTransfer.setData(DRAG_MIME, path);
    e.dataTransfer.setData("text/plain", path);
    e.dataTransfer.effectAllowed = "move";
    setDragSource(path);
  };
  const handleDragEnd = () => {
    setDragSource(null);
    setDropTarget(null);
  };
  const handleFolderDragOver = (e: React.DragEvent, folder: string) => {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
    e.preventDefault();
    // Innermost folder claims the hover; ancestors' handlers must not override
    // the drop target as the event bubbles up the nested wraps.
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDropTarget(folder);
  };
  const handleFolderDragLeave = (folder: string) =>
    setDropTarget((curr) => (curr === folder ? null : curr));
  const handleFolderDrop = async (e: React.DragEvent, folder: string) => {
    e.preventDefault();
    // Only the innermost folder under the cursor performs the move.
    e.stopPropagation();
    const from = e.dataTransfer.getData(DRAG_MIME);
    setDropTarget(null);
    setDragSource(null);
    if (!from) return;
    const fromName = from.split("/").pop()!;
    if (from.split("/").slice(0, -1).join("/") === folder) return;
    try {
      await moveTreePath(from, `${folder}/${fromName}`);
      const moved = notes.find((n) => notePathOf(n) === from);
      if (moved) updateNote({ ...moved, folder });
      pushToast({ icon: "→", agent: "archivist", body: `Moved ${fromName} → ${folder}/` });
    } catch (err) {
      const msg =
        err instanceof ApiError && err.status === 409
          ? `'${fromName}' already exists in ${folder}/`
          : err instanceof Error
            ? err.message
            : "Move failed";
      pushToast({ icon: "⚠", agent: "sentinel", body: msg });
    }
  };

  // --- context menu / rename / delete --------------------------------------
  const beginRename = (path: string) => {
    const last = path.split("/").pop() ?? "";
    const initial = last.endsWith(".md") ? last.slice(0, -3) : last;
    setInteraction({ kind: "rename", path, initial, draft: initial, error: null });
  };

  const submitRename = async () => {
    if (interaction?.kind !== "rename") return;
    const { path, initial, draft: name } = {
      ...interaction,
      draft: interaction.draft.trim(),
    };
    if (!name) return setInteraction({ ...interaction, error: "Name required" });
    if (!SAFE_NAME_RE.test(name)) {
      return setInteraction({
        ...interaction,
        error: "Letters, digits, dashes, underscores only",
      });
    }
    if (name === initial) return setInteraction(null);
    try {
      await renameTreePath(path, name);
      const renamed = notes.find((n) => notePathOf(n) === path);
      if (renamed) {
        const newFilename =
          !renamed.filename || renamed.filename.endsWith(".md")
            ? `${name}.md`
            : name;
        updateNote({ ...renamed, filename: newFilename });
      }
      pushToast({ icon: "✎", agent: "archivist", body: `Renamed → ${name}` });
      setInteraction(null);
    } catch (err) {
      const msg =
        err instanceof ApiError && err.status === 409
          ? "Name already taken"
          : err instanceof Error
            ? err.message
            : "Rename failed";
      setInteraction({ ...interaction, error: msg });
    }
  };

  const performDelete = async (path: string, noteId?: string) => {
    setInteraction(null);
    const last = path.split("/").pop() ?? path;
    if (
      !window.confirm(
        `Archive '${last}'?\n\nIt will move to threads/.archive/ and be removed from the workspace.`,
      )
    )
      return;
    try {
      await archiveTreePath(path);
      // The backend moved the note(s) to threads/.archive/, but app state is
      // only loaded once per vault — drop the archived note(s) here so the tree,
      // graph, backlinks, and palette don't keep pointing at moved files.
      const removed = removeArchivedNotes(notes, path, noteId, removeNote);
      pushToast({ icon: "📦", agent: "archivist", body: `Archived ${last}` });
      if (currentNoteId && removed.has(currentNoteId)) setTab("graph");
    } catch (err) {
      pushToast({
        icon: "⚠",
        agent: "sentinel",
        body: err instanceof Error ? err.message : "Archive failed",
      });
    }
  };

  return {
    // new folder
    creating,
    draft,
    setDraft,
    error,
    busy,
    startCreate,
    cancelCreate,
    submitCreate,
    // drag & drop
    dragSource,
    dropTarget,
    handleDragStart,
    handleDragEnd,
    handleFolderDragOver,
    handleFolderDragLeave,
    handleFolderDrop,
    // context menu / rename / delete
    interaction,
    setInteraction,
    beginRename,
    submitRename,
    performDelete,
  };
}
