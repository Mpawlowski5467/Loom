import { FilePlus, FolderPlus, Search } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { ConfirmModal } from "@/components/ConfirmModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useFolderTree,
  useTreeExpanded,
} from "@/components/layout/tree/treeModel";
import { useTreeActions } from "@/components/layout/tree/useTreeActions";
import { useApp } from "@/context/app-ctx";
import type { Note, NoteId } from "@/data/types";
import { FolderRow } from "./tree/FolderRow";
import type { TreeRowContext } from "./tree/treeContext";

interface VaultTreeProps {
  notes: Note[];
  extraFolders: string[];
  currentNoteId: NoteId | null;
  /** Notes with an unsaved local draft. */
  draftIds: ReadonlySet<NoteId>;
  onNavigate?: () => void;
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

/**
 * The vault's folders and notes: navigate, filter, create notes and folders,
 * drag notes between folders, and rename or archive from a row's menu.
 */
export function VaultTree(props: VaultTreeProps) {
  const { notes, extraFolders } = props;
  const { setNewNoteOpen } = useApp();
  const [filter, setFilter] = useState("");
  const filterLower = filter.trim().toLowerCase();
  const tree = useFolderTree(notes, extraFolders, filterLower);
  const expanded = useTreeExpanded(notes.length < 1_000);
  const folderInput = useRef<HTMLInputElement | null>(null);
  const actions = useTreeActions(folderInput);
  const [archiving, setArchiving] = useState<{
    path: string;
    noteId?: string;
  } | null>(null);

  const ctx: TreeRowContext = {
    actions,
    expanded,
    forceOpen: !!filterLower,
    currentNoteId: props.currentNoteId,
    draftIds: props.draftIds,
    onNavigate: props.onNavigate,
    onArchive: (path, noteId) => setArchiving({ path, noteId }),
  };
  const archiveName = archiving?.path.split("/").pop() ?? "";

  return (
    <nav
      aria-label="Vault"
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={onTreeKeyDown}
    >
      <div className="flex items-center gap-1 px-3 pt-3">
        <h2 className="flex-1 font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
          Vault
        </h2>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="New note"
          title="New note (⌘N)"
          onClick={() => setNewNoteOpen(true)}
        >
          <FilePlus aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="New folder"
          onClick={actions.startCreate}
        >
          <FolderPlus aria-hidden="true" />
        </Button>
      </div>
      {actions.creating && (
        <NewFolderField actions={actions} inputRef={folderInput} />
      )}
      <div className="relative px-3 pt-2 pb-2">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-5.5 size-3.5 -translate-y-1/2 text-muted-foreground"
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
              <FolderRow key={node.path} node={node} depth={0} ctx={ctx} />
            ))}
          </ul>
        )}
      </div>
      {archiving && (
        <ConfirmModal
          title={`Archive "${archiveName}"?`}
          body={
            archiving.noteId
              ? "It moves to threads/.archive/ and leaves the active graph. You can restore it from there."
              : "The folder and every note in it move to threads/.archive/. You can restore them from there."
          }
          confirmLabel="Archive"
          onConfirm={() =>
            actions.performDelete(archiving.path, archiving.noteId)
          }
          onClose={() => setArchiving(null)}
        />
      )}
    </nav>
  );
}

function NewFolderField({
  actions,
  inputRef,
}: {
  actions: TreeRowContext["actions"];
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <form
      className="flex flex-col gap-1 px-3 pt-2"
      onSubmit={(e) => {
        e.preventDefault();
        void actions.submitCreate();
      }}
    >
      <Input
        ref={inputRef}
        value={actions.draft}
        onChange={(e) => actions.setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            actions.cancelCreate();
          }
        }}
        disabled={actions.busy}
        placeholder="folder or folder/sub"
        aria-label="New folder name"
        aria-invalid={actions.error !== null}
        className="h-8 font-mono text-xs"
      />
      {actions.error && (
        <p role="alert" className="text-xs text-danger-foreground">
          {actions.error}
        </p>
      )}
    </form>
  );
}
