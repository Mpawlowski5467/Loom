import type { ReactNode } from "react";
import { Dot } from "../../primitives/Dot";
import { notePathOf } from "../../../api/notes";
import { RESERVED_FOLDERS, type Section, type TreeInteraction } from "./treeModel";

interface MenuTarget {
  target: "file" | "folder";
  path: string;
  noteId?: string;
}

interface FolderSectionProps {
  section: Section;
  open: boolean;
  filterActive: boolean;
  currentNoteId: string | null;
  linkCount: Map<string, number>;
  interaction: TreeInteraction;
  dropTarget: string | null;
  dragSource: string | null;
  onToggle: (folder: string) => void;
  onOpenNote: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, target: MenuTarget) => void;
  onRenameChange: (draft: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  onDragStart: (e: React.DragEvent, path: string) => void;
  onDragEnd: () => void;
  onFolderDragOver: (e: React.DragEvent, folder: string) => void;
  onFolderDragLeave: (folder: string) => void;
  onFolderDrop: (e: React.DragEvent, folder: string) => void;
}

function RenameInput(props: {
  interaction: Extract<TreeInteraction, { kind: "rename" }>;
  onChange: (draft: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}): ReactNode {
  return (
    <>
      <input
        autoFocus
        className="tree-rename-input"
        value={props.interaction.draft}
        onChange={(e) => props.onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            props.onSubmit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            props.onCancel();
          }
        }}
        onBlur={props.onCancel}
        aria-invalid={props.interaction.error !== null}
      />
      {props.interaction.error && (
        <span className="tree-new-folder-error">{props.interaction.error}</span>
      )}
    </>
  );
}

export function FolderSection(props: FolderSectionProps): ReactNode {
  const { section, interaction } = props;
  const isDropping = props.dropTarget === section.folder;
  const folderEditable = !RESERVED_FOLDERS.has(section.folder);
  const renaming = interaction?.kind === "rename" ? interaction : null;
  const folderRenaming = renaming?.path === section.folder;

  return (
    <div
      className={`tree-section-wrap ${isDropping ? "drop" : ""}`}
      onDragOver={(e) => props.onFolderDragOver(e, section.folder)}
      onDragLeave={() => props.onFolderDragLeave(section.folder)}
      onDrop={(e) => void props.onFolderDrop(e, section.folder)}
    >
      {folderRenaming && renaming ? (
        <div className="tree-section">
          <RenameInput
            interaction={renaming}
            onChange={props.onRenameChange}
            onSubmit={props.onRenameSubmit}
            onCancel={props.onRenameCancel}
          />
        </div>
      ) : (
        <div
          className="tree-section"
          draggable={folderEditable}
          onDragStart={
            folderEditable
              ? (e) => props.onDragStart(e, section.folder)
              : undefined
          }
          onDragEnd={props.onDragEnd}
          onContextMenu={(e) =>
            folderEditable &&
            props.onContextMenu(e, { target: "folder", path: section.folder })
          }
        >
          <button
            type="button"
            className="tree-section-chevron"
            aria-label={props.open ? "Collapse folder" : "Expand folder"}
            aria-expanded={props.open}
            onClick={(e) => {
              e.stopPropagation();
              props.onToggle(section.folder);
            }}
            disabled={props.filterActive}
          >
            <span className={`chevron ${props.open ? "open" : ""}`}>▸</span>
          </button>
          <span className="tree-section-name">{section.folder}</span>
        </div>
      )}

      {props.open && section.notes.length === 0 && (
        <div className="tree-empty">empty</div>
      )}
      {props.open &&
        section.notes.map((n) => {
          const notePath = notePathOf(n);
          const rowRenaming = renaming?.path === notePath;
          return rowRenaming && renaming ? (
            <div key={n.id} className="tree-row tree-row--rename">
              <Dot type={n.type} />
              <RenameInput
                interaction={renaming}
                onChange={props.onRenameChange}
                onSubmit={props.onRenameSubmit}
                onCancel={props.onRenameCancel}
              />
            </div>
          ) : (
            <button
              key={n.id}
              role="treeitem"
              aria-current={props.currentNoteId === n.id ? "page" : undefined}
              className={`tree-row ${props.dragSource === notePath ? "drag" : ""}`}
              onClick={() => props.onOpenNote(n.id)}
              draggable
              onDragStart={(e) => props.onDragStart(e, notePath)}
              onDragEnd={props.onDragEnd}
              onContextMenu={(e) =>
                props.onContextMenu(e, {
                  target: "file",
                  path: notePath,
                  noteId: n.id,
                })
              }
            >
              <Dot type={n.type} />
              <span className="tree-row-name">{n.title}</span>
              <span className="tree-row-count">{props.linkCount.get(n.id) ?? 0}</span>
            </button>
          );
        })}
    </div>
  );
}
