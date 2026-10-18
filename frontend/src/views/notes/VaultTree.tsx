import { ChevronRight, FileText, Folder, Search } from "lucide-react";
import { useMemo, useState, type KeyboardEvent } from "react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { noteHref } from "@/app/routes";
import {
  useFolderTree,
  useTreeExpanded,
  type FolderTreeNode,
} from "@/components/layout/tree/treeModel";
import type { Note, NoteId } from "@/data/types";
import { isSuperseded } from "@/data/supersession";
import { cn } from "@/lib/utils";

/** Rows rendered per folder before "Show more" (large vaults). */
const PAGE = 200;

interface VaultTreeProps {
  notes: Note[];
  extraFolders: string[];
  currentNoteId: NoteId | null;
  /** Notes with an unsaved local draft. */
  draftIds: ReadonlySet<NoteId>;
  onNavigate?: () => void;
}

function countNotes(node: FolderTreeNode): number {
  return (
    node.notes.length + node.folders.reduce((n, f) => n + countNotes(f), 0)
  );
}

/** Up/Down moves between rows; Enter/Space activate them natively. */
function onTreeKeyDown(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  if ((e.target as HTMLElement).tagName === "INPUT") return;
  const rows = Array.from(
    e.currentTarget.querySelectorAll<HTMLElement>("[data-tree-row]"),
  );
  const idx = rows.indexOf(document.activeElement as HTMLElement);
  const next =
    e.key === "ArrowDown"
      ? rows[Math.min(rows.length - 1, idx + 1)]
      : rows[Math.max(0, idx - 1)];
  if (next) {
    e.preventDefault();
    next.focus();
  }
}

/** The vault's folders and notes, for navigating between notes. */
export function VaultTree(props: VaultTreeProps) {
  const { notes, extraFolders } = props;
  const [filter, setFilter] = useState("");
  const filterLower = filter.trim().toLowerCase();
  const tree = useFolderTree(notes, extraFolders, filterLower);
  const expanded = useTreeExpanded(notes.length < 1_000);

  return (
    <nav
      aria-label="Vault"
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={onTreeKeyDown}
    >
      <div className="relative px-3 pt-3 pb-2">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-5.5 mt-0.5 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter notes…"
          aria-label="Filter notes by title"
          className="h-8 pl-8 text-sm"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {tree.length === 0 ? (
          <p className="px-2 py-4 text-sm text-muted-foreground">
            {filterLower ? "No notes match." : "No notes yet."}
          </p>
        ) : (
          <ul>
            {tree.map((node) => (
              <FolderRow
                key={node.path}
                node={node}
                depth={0}
                expanded={expanded}
                forceOpen={!!filterLower}
                {...props}
              />
            ))}
          </ul>
        )}
      </div>
    </nav>
  );
}

interface RowProps extends VaultTreeProps {
  node: FolderTreeNode;
  depth: number;
  expanded: ReturnType<typeof useTreeExpanded>;
  forceOpen: boolean;
}

function FolderRow(props: RowProps) {
  const { node, depth, expanded, forceOpen } = props;
  const open = forceOpen || expanded.isExpanded(node.path);
  const [limit, setLimit] = useState(PAGE);
  const count = useMemo(() => countNotes(node), [node]);
  const pad = { paddingLeft: `${0.5 + depth * 0.75}rem` };
  return (
    <li>
      <button
        type="button"
        data-tree-row
        aria-expanded={open}
        onClick={() => expanded.toggle(node.path)}
        style={pad}
        className="flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left text-sm text-secondary-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
        <span className="ml-auto font-mono text-[11px] text-muted-foreground tabular-nums">
          {count}
        </span>
      </button>
      {open && (
        <ul>
          {node.folders.map((child) => (
            <FolderRow
              key={child.path}
              {...props}
              node={child}
              depth={depth + 1}
            />
          ))}
          {node.notes.slice(0, limit).map((note) => (
            <NoteRow key={note.id} {...props} note={note} depth={depth + 1} />
          ))}
          {node.notes.length > limit && (
            <li>
              <button
                type="button"
                data-tree-row
                onClick={() => setLimit((n) => n + PAGE)}
                style={{ paddingLeft: `${1.75 + depth * 0.75}rem` }}
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

function NoteRow({
  note,
  depth,
  currentNoteId,
  draftIds,
  onNavigate,
}: RowProps & { note: Note }) {
  const active = note.id === currentNoteId;
  const superseded = isSuperseded(note);
  return (
    <li>
      <Link
        to={noteHref(note)}
        data-tree-row
        aria-current={active ? "page" : undefined}
        onClick={onNavigate}
        style={{ paddingLeft: `${1.75 + depth * 0.75}rem` }}
        className={cn(
          "flex h-7 items-center gap-1.5 rounded-md pr-2 text-sm text-secondary-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
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
        {draftIds.has(note.id) && (
          <span
            className="ml-auto size-1.5 shrink-0 rounded-full bg-brand"
            aria-label="Unsaved draft"
            role="img"
          />
        )}
      </Link>
    </li>
  );
}
