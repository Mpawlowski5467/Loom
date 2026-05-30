import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { useApp } from "../../context/app-ctx";
import { FolderSection } from "./tree/FolderSection";
import {
  useFolderTree,
  useLinkCount,
  useTreeExpanded,
} from "./tree/treeModel";
import { useTreeActions } from "./tree/useTreeActions";

export function Tree(): ReactNode {
  const { notes, notesLoaded, currentNoteId, openNote, extraFolders } =
    useApp();

  const treeRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [filter, setFilter] = useState("");
  const filterLower = filter.trim().toLowerCase();

  const { isExpanded, toggle } = useTreeExpanded();
  const tree = useFolderTree(notes, extraFolders, filterLower);
  const linkCount = useLinkCount(notes);

  const {
    creating,
    draft,
    setDraft,
    error,
    busy,
    startCreate,
    cancelCreate,
    submitCreate,
    dragSource,
    dropTarget,
    handleDragStart,
    handleDragEnd,
    handleFolderDragOver,
    handleFolderDragLeave,
    handleFolderDrop,
    interaction,
    setInteraction,
    beginRename,
    submitRename,
    performDelete,
  } = useTreeActions(inputRef);

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

      {tree.length === 0 &&
        (!notesLoaded ? (
          <div className="tree-state" aria-busy="true" role="status">
            <span className="tree-skeleton-row" />
            <span className="tree-skeleton-row" />
            <span className="tree-skeleton-row" />
          </div>
        ) : filterLower ? (
          <div className="tree-state tree-state-empty">
            No notes match “{filter.trim()}”
          </div>
        ) : (
          <div className="tree-state tree-state-empty">
            No notes yet — press <kbd>⌘N</kbd> to create one.
          </div>
        ))}

      {tree.map((node) => (
        <FolderSection
          key={node.path}
          node={node}
          depth={0}
          isExpanded={isExpanded}
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
