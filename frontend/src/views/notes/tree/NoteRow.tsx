import { FileText } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { notePathOf } from "@/api/notes";
import { noteHref } from "@/app/routes";
import { Badge } from "@/components/ui/badge";
import { isSuperseded } from "@/data/supersession";
import type { Note } from "@/data/types";
import { cn } from "@/lib/utils";
import { RenameField } from "./RenameField";
import { RowMenu } from "./RowMenu";
import {
  indent,
  menuOpeners,
  rowClass,
  type TreeRowContext,
} from "./treeContext";

/** One note: a link to it, draggable onto a folder, with rename/archive. */
export function NoteRow({
  note,
  depth,
  ctx,
}: {
  note: Note;
  depth: number;
  ctx: TreeRowContext;
}) {
  const { actions } = ctx;
  const [menuOpen, setMenuOpen] = useState(false);
  const path = notePathOf(note);
  const active = note.id === ctx.currentNoteId;
  const superseded = isSuperseded(note);
  const renaming =
    actions.interaction?.kind === "rename" && actions.interaction.path === path;

  if (renaming)
    return (
      <li>
        <RenameField
          actions={actions}
          label={`Rename file ${note.title}`}
          style={indent(depth, true)}
        />
      </li>
    );
  return (
    <li className="group relative flex">
      <Link
        to={noteHref(note)}
        data-tree-row
        aria-current={active ? "page" : undefined}
        onClick={ctx.onNavigate}
        draggable
        onDragStart={(e) => actions.handleDragStart(e, path)}
        onDragEnd={actions.handleDragEnd}
        {...menuOpeners(() => setMenuOpen(true))}
        style={indent(depth, true)}
        className={cn(
          rowClass,
          actions.dragSource === path && "opacity-50",
          active && "bg-nav-active text-nav-active-foreground",
        )}
      >
        <FileText
          aria-hidden="true"
          className="size-3.5 shrink-0 text-muted-foreground"
        />
        <span
          className={cn(
            "truncate",
            superseded && "text-muted-foreground line-through",
          )}
        >
          {note.title}
        </span>
        {superseded && (
          <Badge
            variant="outline"
            className="h-4 px-1 font-mono text-[10px] text-muted-foreground"
          >
            superseded
          </Badge>
        )}
        {ctx.draftIds.has(note.id) && (
          <span
            className="ml-auto size-1.5 shrink-0 rounded-full bg-brand"
            aria-label="Unsaved draft"
            role="img"
          />
        )}
      </Link>
      <RowMenu
        name={note.title}
        open={menuOpen}
        onOpenChange={setMenuOpen}
        renameLabel="Rename file"
        onRename={() => actions.beginRename(path)}
        onArchive={() => ctx.onArchive(path, note.id)}
      />
    </li>
  );
}
