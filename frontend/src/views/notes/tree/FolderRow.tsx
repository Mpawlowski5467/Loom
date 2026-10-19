import { ChevronRight, Folder } from "lucide-react";
import { useMemo, useState } from "react";
import {
  RESERVED_FOLDERS,
  type FolderTreeNode,
} from "@/components/layout/tree/treeModel";
import { cn } from "@/lib/utils";
import { NoteRow } from "./NoteRow";
import { RenameField } from "./RenameField";
import { RowMenu } from "./RowMenu";
import {
  indent,
  menuOpeners,
  rowClass,
  type TreeRowContext,
} from "./treeContext";

/** Rows rendered per folder before "Show more" (large vaults). */
const PAGE = 200;

function countNotes(node: FolderTreeNode): number {
  return (
    node.notes.length + node.folders.reduce((n, f) => n + countNotes(f), 0)
  );
}

interface FolderRowProps {
  node: FolderTreeNode;
  depth: number;
  ctx: TreeRowContext;
}

/** A folder, its subfolders and its notes; a drop target for moves. */
export function FolderRow({ node, depth, ctx }: FolderRowProps) {
  const { actions, expanded } = ctx;
  const open = ctx.forceOpen || expanded.isExpanded(node.path);
  const [limit, setLimit] = useState(PAGE);
  const [menuOpen, setMenuOpen] = useState(false);
  const count = useMemo(() => countNotes(node), [node]);
  const editable = !RESERVED_FOLDERS.has(node.path);
  const renaming =
    actions.interaction?.kind === "rename" &&
    actions.interaction.path === node.path;
  const dropping = actions.dropTarget === node.path;

  return (
    <li
      onDragOver={(e) => actions.handleFolderDragOver(e, node.path)}
      onDragLeave={() => actions.handleFolderDragLeave(node.path)}
      onDrop={(e) => void actions.handleFolderDrop(e, node.path)}
      className={cn("rounded-md", dropping && "bg-accent ring-1 ring-brand")}
    >
      {renaming ? (
        <RenameField
          actions={actions}
          label={`Rename folder ${node.name}`}
          style={indent(depth)}
        />
      ) : (
        <div className="group relative flex">
          <button
            type="button"
            data-tree-row
            aria-expanded={open}
            draggable={editable}
            onDragStart={(e) => actions.handleDragStart(e, node.path)}
            onDragEnd={actions.handleDragEnd}
            onClick={() => expanded.toggle(node.path)}
            {...(editable ? menuOpeners(() => setMenuOpen(true)) : {})}
            style={indent(depth)}
            className={rowClass}
          >
            <ChevronRight
              aria-hidden="true"
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform",
                open && "rotate-90",
              )}
            />
            <Folder
              aria-hidden="true"
              className="size-3.5 shrink-0 text-muted-foreground"
            />
            <span className="truncate">{node.name}</span>
            <span className="ml-auto font-mono text-[11px] text-muted-foreground tabular-nums group-hover:invisible">
              {count}
            </span>
          </button>
          {editable && (
            <RowMenu
              name={node.name}
              open={menuOpen}
              onOpenChange={setMenuOpen}
              renameLabel="Rename folder"
              onRename={() => actions.beginRename(node.path)}
              onArchive={() => ctx.onArchive(node.path)}
            />
          )}
        </div>
      )}
      {open && (
        <ul>
          {node.folders.map((child) => (
            <FolderRow
              key={child.path}
              node={child}
              depth={depth + 1}
              ctx={ctx}
            />
          ))}
          {node.notes.slice(0, limit).map((note) => (
            <NoteRow key={note.id} note={note} depth={depth + 1} ctx={ctx} />
          ))}
          {node.notes.length > limit && (
            <li>
              <button
                type="button"
                data-tree-row
                onClick={() => setLimit((n) => n + PAGE)}
                style={indent(depth, true)}
                className="h-7 w-full rounded-md text-left text-xs text-muted-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                Show {Math.min(PAGE, node.notes.length - limit)} more
              </button>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}
