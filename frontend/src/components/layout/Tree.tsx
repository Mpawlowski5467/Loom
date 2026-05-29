import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useApp } from "../../context/app-ctx";
import {
  archiveTreePath,
  createFolder,
  moveTreePath,
  notePathOf,
  renameTreePath,
} from "../../api/notes";
import { ApiError } from "../../api/client";
import { FolderSection } from "./tree/FolderSection";
import {
  DRAG_MIME,
  FOLDER_NAME_RE,
  SAFE_NAME_RE,
  useLinkCount,
  useTreeExpanded,
  useTreeSections,
  type TreeInteraction,
} from "./tree/treeModel";

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

  const treeRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

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

  const [filter, setFilter] = useState("");
  const filterLower = filter.trim().toLowerCase();

  const { isExpanded, toggle } = useTreeExpanded();
  const sections = useTreeSections(notes, extraFolders, filterLower);
  const linkCount = useLinkCount(notes);

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
      if (err instanceof ApiError && err.status === 409) setError("Folder already exists");
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
    e.dataTransfer.dropEffect = "move";
    setDropTarget(folder);
  };
  const handleFolderDragLeave = (folder: string) =>
    setDropTarget((curr) => (curr === folder ? null : curr));
  const handleFolderDrop = async (e: React.DragEvent, folder: string) => {
    e.preventDefault();
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
    const { path, initial, draft: name } = { ...interaction, draft: interaction.draft.trim() };
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
      pushToast({ icon: "📦", agent: "archivist", body: `Archived ${last}` });
      if (noteId && currentNoteId === noteId) setTab("graph");
    } catch (err) {
      pushToast({
        icon: "⚠",
        agent: "sentinel",
        body: err instanceof Error ? err.message : "Archive failed",
      });
    }
  };

  // Arrow-key navigation between note rows (rows are buttons, so Enter opens
  // natively). Ignored while typing in the filter / rename fields.
  const onTreeKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const t = e.target as HTMLElement;
    if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
    const rows = Array.from(
      treeRef.current?.querySelectorAll<HTMLElement>(
        ".tree-row:not(.tree-row--rename)",
      ) ?? [],
    );
    if (rows.length === 0) return;
    e.preventDefault();
    const idx = rows.indexOf(document.activeElement as HTMLElement);
    let next: HTMLElement | undefined;
    if (idx === -1) next = e.key === "ArrowDown" ? rows[0] : rows[rows.length - 1];
    else if (e.key === "ArrowDown") next = rows[Math.min(rows.length - 1, idx + 1)];
    else next = rows[Math.max(0, idx - 1)];
    next?.focus();
  };

  return (
    <aside className="tree" role="tree" ref={treeRef} onKeyDown={onTreeKeyDown}>
      <div className="tree-filter">
        <input
          type="search"
          className="tree-filter-input"
          placeholder="Filter notes…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter notes by title"
        />
      </div>
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
            <div id="tree-new-folder-error" className="tree-new-folder-error" role="alert">
              {error}
            </div>
          )}
        </div>
      )}

      {sections.map((s) => (
        <FolderSection
          key={s.folder}
          section={s}
          open={filterLower ? true : isExpanded(s.folder)}
          filterActive={!!filterLower}
          currentNoteId={currentNoteId}
          linkCount={linkCount}
          interaction={interaction}
          dropTarget={dropTarget}
          dragSource={dragSource}
          onToggle={toggle}
          onOpenNote={openNote}
          onContextMenu={(e, target) => {
            e.preventDefault();
            e.stopPropagation();
            setInteraction({ kind: "menu", x: e.clientX, y: e.clientY, ...target });
          }}
          onRenameChange={(d) =>
            setInteraction((prev) =>
              prev?.kind === "rename" ? { ...prev, draft: d, error: null } : prev,
            )
          }
          onRenameSubmit={() => void submitRename()}
          onRenameCancel={() => setInteraction(null)}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onFolderDragOver={handleFolderDragOver}
          onFolderDragLeave={handleFolderDragLeave}
          onFolderDrop={handleFolderDrop}
        />
      ))}

      {interaction?.kind === "menu" && (
        <ul
          className="tree-context-menu"
          role="menu"
          style={{ top: interaction.y, left: interaction.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <li>
            <button type="button" role="menuitem" onClick={() => beginRename(interaction.path)}>
              Rename
            </button>
          </li>
          <li>
            <button
              type="button"
              role="menuitem"
              className="danger"
              onClick={() => void performDelete(interaction.path, interaction.noteId)}
            >
              {interaction.target === "folder" ? "Archive folder" : "Archive"}
            </button>
          </li>
        </ul>
      )}
    </aside>
  );
}
