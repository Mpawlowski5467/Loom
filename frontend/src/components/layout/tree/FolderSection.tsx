import type { CSSProperties, ReactNode } from "react";
import { Dot } from "../../primitives/Dot";
import { notePathOf } from "../../../api/notes";
import {
  RESERVED_FOLDERS,
  type FolderTreeNode,
  type TreeInteraction,
} from "./treeModel";

const INDENT_STEP = 12;

/** Depth → left-indent, exposed as the ``--indent`` custom property the tree
 * CSS folds into each row's left padding. */
const indentStyle = (depth: number): CSSProperties =>
  ({ "--indent": `${depth * INDENT_STEP}px` }) as CSSProperties;

interface MenuTarget {
  target: "file" | "folder";
  path: string;
  noteId?: string;
}

interface FolderSectionProps {
  node: FolderTreeNode;
  /** Nesting depth of this folder; 0 for top level. */
  depth: number;
  isExpanded: (path: string) => boolean;
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

/**
 * One folder and its contents, rendered recursively: header, then child
 * folders (folders first), then the files in this folder. Indentation grows
 * with ``depth``; everything is keyed off the folder's full path so nested
 * folders behave like top-level ones for expand/collapse, drag-drop, rename,
 * and the context menu.
 */
export function FolderSection(props: FolderSectionProps): ReactNode {
  const { node, depth, interaction } = props;
  const open = props.filterActive || props.isExpanded(node.path);
  const isDropping = props.dropTarget === node.path;
  const folderEditable = !RESERVED_FOLDERS.has(node.path);
  const renaming = interaction?.kind === "rename" ? interaction : null;
  const folderRenaming = renaming?.path === node.path;
  const childDepth = depth + 1;

  return (
    <div
      className={`tree-section-wrap ${isDropping ? "drop" : ""}`}
      onDragOver={(e) => props.onFolderDragOver(e, node.path)}
      onDragLeave={() => props.onFolderDragLeave(node.path)}
      onDrop={(e) => void props.onFolderDrop(e, node.path)}
    >
      {folderRenaming && renaming ? (
        <div className="tree-section" style={indentStyle(depth)}>
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
          style={indentStyle(depth)}
          draggable={folderEditable}
          onDragStart={
            folderEditable
              ? (e) => props.onDragStart(e, node.path)
              : undefined
          }
          onDragEnd={props.onDragEnd}
          onContextMenu={(e) =>
            folderEditable &&
            props.onContextMenu(e, { target: "folder", path: node.path })
          }
        >
          <button
            type="button"
            className="tree-section-chevron"
            aria-label={open ? "Collapse folder" : "Expand folder"}
            aria-expanded={open}
            onClick={(e) => {
              e.stopPropagation();
              props.onToggle(node.path);
            }}
            disabled={props.filterActive}
          >
            <span className={`chevron ${open ? "open" : ""}`}>▸</span>
          </button>
          <span className="tree-section-name">{node.name}</span>
        </div>
      )}

      {open &&
        node.folders.map((child) => (
          <FolderSection
            key={child.path}
            {...props}
            node={child}
            depth={childDepth}
          />
        ))}

      {open && node.folders.length === 0 && node.notes.length === 0 && (
        <div className="tree-empty" style={indentStyle(childDepth)}>
          empty
        </div>
      )}

      {open &&
        node.notes.map((n) => {
          const notePath = notePathOf(n);
          const rowRenaming = renaming?.path === notePath;
          return rowRenaming && renaming ? (
            <div
              key={n.id}
              className="tree-row tree-row--rename"
              style={indentStyle(childDepth)}
            >
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
              style={indentStyle(childDepth)}
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
              <span className="tree-row-count">
                {props.linkCount.get(n.id) ?? 0}
              </span>
            </button>
          );
        })}
    </div>
  );
}
