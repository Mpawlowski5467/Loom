import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useApp } from "../../context/app-ctx";
import type { Note, NodeType } from "../../data/types";
import { Dot } from "../primitives/Dot";
import {
  archiveTreePath,
  createFolder,
  moveTreePath,
  notePathOf,
  renameTreePath,
} from "../../api/notes";
import { ApiError } from "../../api/client";

interface Section {
  folder: string;
  type: NodeType;
  notes: Note[];
}

const FOLDER_ORDER: { folder: string; type: NodeType }[] = [
  { folder: "daily", type: "daily" },
  { folder: "projects", type: "project" },
  { folder: "topics", type: "topic" },
  { folder: "people", type: "people" },
  { folder: "captures", type: "capture" },
  { folder: "reading", type: "custom" },
  { folder: "scratch", type: "custom" },
  { folder: "agents", type: "people" },
];

const FOLDER_TYPE_BY_NAME = new Map(
  FOLDER_ORDER.map((f) => [f.folder, f.type] as const),
);

const FOLDER_NAME_RE = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;
const SAFE_NAME_RE = /^[A-Za-z0-9_-]+$/;

const RESERVED_FOLDERS = new Set([
  "daily",
  "projects",
  "topics",
  "people",
  "captures",
]);

const DRAG_MIME = "application/x-loom-path";

interface ContextMenuState {
  x: number;
  y: number;
  kind: "file" | "folder";
  path: string;
  noteId?: string;
}

interface InlineRename {
  path: string;
  initial: string;
}

export function Tree(): ReactNode {
  const {
    notes,
    currentNoteId,
    openNote,
    extraFolders,
    addFolder,
    pushToast,
    updateNote,
    setTab,
  } = useApp();

  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  const [dragSource, setDragSource] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [rename, setRename] = useState<InlineRename | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);

  const sections = useMemo<Section[]>(() => {
    const byFolder = new Map<string, Note[]>();
    for (const n of notes) {
      const arr = byFolder.get(n.folder) ?? [];
      arr.push(n);
      byFolder.set(n.folder, arr);
    }

    const seen = new Set<string>();
    const out: Section[] = [];

    for (const f of FOLDER_ORDER) {
      const arr = byFolder.get(f.folder);
      if (!arr || arr.length === 0) continue;
      seen.add(f.folder);
      out.push({
        folder: f.folder,
        type: f.type,
        notes: [...arr].sort((a, b) =>
          a.type === "daily"
            ? b.title.localeCompare(a.title)
            : a.title.localeCompare(b.title),
        ),
      });
    }

    for (const folder of extraFolders) {
      if (seen.has(folder)) continue;
      seen.add(folder);
      const arr = byFolder.get(folder) ?? [];
      const type: NodeType = FOLDER_TYPE_BY_NAME.get(folder) ?? "custom";
      out.push({
        folder,
        type,
        notes: [...arr].sort((a, b) => a.title.localeCompare(b.title)),
      });
    }

    return out;
  }, [notes, extraFolders]);

  const linkCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of notes) {
      m.set(n.id, (m.get(n.id) ?? 0) + n.links.length);
      for (const l of n.links) m.set(l, (m.get(l) ?? 0) + 1);
    }
    return m;
  }, [notes]);

  useEffect(() => {
    if (!menu) return;
    const onDown = () => setMenu(null);
    window.addEventListener("click", onDown);
    window.addEventListener("scroll", onDown, true);
    return () => {
      window.removeEventListener("click", onDown);
      window.removeEventListener("scroll", onDown, true);
    };
  }, [menu]);

  useEffect(() => {
    if (rename) {
      setTimeout(() => renameInputRef.current?.focus(), 0);
    }
  }, [rename]);

  // --- new folder -----------------------------------------------------------

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
    if (!name) {
      setError("Name required");
      return;
    }
    if (!FOLDER_NAME_RE.test(name)) {
      setError("Letters, digits, dashes, underscores; '/' for nesting");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createFolder(name);
      addFolder(name);
      pushToast({
        icon: "📁",
        agent: "archivist",
        body: `Created folder ${name}/`,
      });
      cancelCreate();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError("Folder already exists");
      } else {
        setError(err instanceof Error ? err.message : "Failed to create folder");
      }
    } finally {
      setBusy(false);
    }
  };

  // --- drag & drop ----------------------------------------------------------

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
    e.dataTransfer.dropEffect = "move";
    setDropTarget(folder);
  };

  const handleFolderDragLeave = (folder: string) => {
    setDropTarget((curr) => (curr === folder ? null : curr));
  };

  const handleFolderDrop = async (e: React.DragEvent, folder: string) => {
    e.preventDefault();
    const from = e.dataTransfer.getData(DRAG_MIME);
    setDropTarget(null);
    setDragSource(null);
    if (!from) return;

    const fromName = from.split("/").pop()!;
    const fromParent = from.split("/").slice(0, -1).join("/");
    if (fromParent === folder) return;

    const to = `${folder}/${fromName}`;
    try {
      await moveTreePath(from, to);
      const movedNote = notes.find((n) => notePathOf(n) === from);
      if (movedNote) {
        updateNote({ ...movedNote, folder });
      }
      pushToast({
        icon: "→",
        agent: "archivist",
        body: `Moved ${fromName} → ${folder}/`,
      });
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

  const openContextMenu = (
    e: React.MouseEvent,
    state: Omit<ContextMenuState, "x" | "y">,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, ...state });
  };

  const beginRename = (path: string) => {
    const last = path.split("/").pop() ?? "";
    const initial = last.endsWith(".md") ? last.slice(0, -3) : last;
    setRename({ path, initial });
    setRenameDraft(initial);
    setRenameError(null);
    setMenu(null);
  };

  const submitRename = async () => {
    if (!rename) return;
    const name = renameDraft.trim();
    if (!name) {
      setRenameError("Name required");
      return;
    }
    if (!SAFE_NAME_RE.test(name)) {
      setRenameError("Letters, digits, dashes, underscores only");
      return;
    }
    if (name === rename.initial) {
      setRename(null);
      return;
    }
    try {
      await renameTreePath(rename.path, name);
      const renamedNote = notes.find((n) => notePathOf(n) === rename.path);
      if (renamedNote) {
        const newFilename = renamedNote.filename
          ? renamedNote.filename.endsWith(".md")
            ? `${name}.md`
            : name
          : `${name}.md`;
        updateNote({ ...renamedNote, filename: newFilename });
      }
      pushToast({
        icon: "✎",
        agent: "archivist",
        body: `Renamed → ${name}`,
      });
      setRename(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setRenameError("Name already taken");
      } else {
        setRenameError(err instanceof Error ? err.message : "Rename failed");
      }
    }
  };

  const performDelete = async (path: string, noteId?: string) => {
    setMenu(null);
    const last = path.split("/").pop() ?? path;
    const confirmed = window.confirm(
      `Archive '${last}'?\n\nIt will move to threads/.archive/ and be removed from the workspace.`,
    );
    if (!confirmed) return;
    try {
      await archiveTreePath(path);
      pushToast({
        icon: "📦",
        agent: "archivist",
        body: `Archived ${last}`,
      });
      if (noteId && currentNoteId === noteId) {
        setTab("graph");
      }
    } catch (err) {
      pushToast({
        icon: "⚠",
        agent: "sentinel",
        body: err instanceof Error ? err.message : "Archive failed",
      });
    }
  };

  // --- render ---------------------------------------------------------------

  return (
    <aside className="tree" role="tree">
      <div className="vault-badge-row">
        <div className="vault-badge">loom-vault</div>
        <button
          type="button"
          className="tree-icon-btn"
          aria-label="New folder"
          title="New folder"
          onClick={startCreate}
          disabled={creating}
        >
          ＋
        </button>
      </div>

      {creating && (
        <div className="tree-new-folder">
          <input
            ref={inputRef}
            className="tree-new-folder-input"
            value={draft}
            placeholder="folder-name"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submitCreate();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                cancelCreate();
              }
            }}
            disabled={busy}
            aria-invalid={error !== null}
            aria-describedby={error ? "tree-new-folder-error" : undefined}
          />
          {error && (
            <div
              id="tree-new-folder-error"
              className="tree-new-folder-error"
              role="alert"
            >
              {error}
            </div>
          )}
        </div>
      )}

      {sections.map((s) => {
        const isDropping = dropTarget === s.folder;
        const folderEditable = !RESERVED_FOLDERS.has(s.folder);
        const folderRenaming = rename?.path === s.folder;
        return (
          <div
            key={s.folder}
            className={`tree-section-wrap ${isDropping ? "drop" : ""}`}
            onDragOver={(e) => handleFolderDragOver(e, s.folder)}
            onDragLeave={() => handleFolderDragLeave(s.folder)}
            onDrop={(e) => void handleFolderDrop(e, s.folder)}
          >
            {folderRenaming ? (
              <div className="tree-section">
                <input
                  ref={renameInputRef}
                  className="tree-rename-input"
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void submitRename();
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setRename(null);
                    }
                  }}
                  onBlur={() => setRename(null)}
                  aria-invalid={renameError !== null}
                />
                {renameError && (
                  <div className="tree-new-folder-error">{renameError}</div>
                )}
              </div>
            ) : (
              <div
                className="tree-section"
                draggable={folderEditable}
                onDragStart={
                  folderEditable
                    ? (e) => handleDragStart(e, s.folder)
                    : undefined
                }
                onDragEnd={handleDragEnd}
                onContextMenu={(e) =>
                  folderEditable &&
                  openContextMenu(e, { kind: "folder", path: s.folder })
                }
              >
                {s.folder}
              </div>
            )}

            {s.notes.length === 0 && <div className="tree-empty">empty</div>}
            {s.notes.map((n) => {
              const notePath = notePathOf(n);
              const isRowRenaming = rename?.path === notePath;
              const isDraggingRow = dragSource === notePath;
              return isRowRenaming ? (
                <div key={n.id} className="tree-row tree-row--rename">
                  <Dot type={n.type} />
                  <input
                    ref={renameInputRef}
                    className="tree-rename-input"
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void submitRename();
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setRename(null);
                      }
                    }}
                    onBlur={() => setRename(null)}
                    aria-invalid={renameError !== null}
                  />
                  {renameError && (
                    <span className="tree-new-folder-error">
                      {renameError}
                    </span>
                  )}
                </div>
              ) : (
                <button
                  key={n.id}
                  role="treeitem"
                  aria-current={currentNoteId === n.id ? "page" : undefined}
                  className={`tree-row ${isDraggingRow ? "drag" : ""}`}
                  onClick={() => openNote(n.id)}
                  draggable
                  onDragStart={(e) => handleDragStart(e, notePath)}
                  onDragEnd={handleDragEnd}
                  onContextMenu={(e) =>
                    openContextMenu(e, {
                      kind: "file",
                      path: notePath,
                      noteId: n.id,
                    })
                  }
                >
                  <Dot type={n.type} />
                  <span className="tree-row-name">{n.title}</span>
                  <span className="tree-row-count">
                    {linkCount.get(n.id) ?? 0}
                  </span>
                </button>
              );
            })}
          </div>
        );
      })}

      {menu && (
        <ul
          className="tree-context-menu"
          role="menu"
          style={{ top: menu.y, left: menu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <li>
            <button
              type="button"
              role="menuitem"
              onClick={() => beginRename(menu.path)}
            >
              Rename
            </button>
          </li>
          <li>
            <button
              type="button"
              role="menuitem"
              className="danger"
              onClick={() => void performDelete(menu.path, menu.noteId)}
            >
              {menu.kind === "folder" ? "Archive folder" : "Archive"}
            </button>
          </li>
        </ul>
      )}
    </aside>
  );
}
