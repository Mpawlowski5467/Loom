import type { useTreeActions } from "@/components/layout/tree/useTreeActions";
import type { useTreeExpanded } from "@/components/layout/tree/treeModel";
import type { KeyboardEvent, MouseEvent } from "react";
import type { NoteId } from "@/data/types";

/** What every tree row needs: state, actions and the shared callbacks. */
export interface TreeRowContext {
  actions: ReturnType<typeof useTreeActions>;
  expanded: ReturnType<typeof useTreeExpanded>;
  /** A filter is active: folders stay open and can't collapse. */
  forceOpen: boolean;
  currentNoteId: NoteId | null;
  draftIds: ReadonlySet<NoteId>;
  onNavigate?: () => void;
  /** Ask before archiving a note or folder. */
  onArchive: (path: string, noteId?: string) => void;
}

/** Indent for a row at `depth`; notes sit one chevron further in. */
export const indent = (depth: number, note = false) => ({
  paddingLeft: `${(note ? 1.75 : 0.5) + depth * 0.75}rem`,
});

export const rowClass =
  "flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md pr-7 text-left text-sm text-secondary-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/** Right-click, the Menu key or Shift+F10 open a row's menu. */
export function menuOpeners(open: () => void) {
  return {
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      open();
    },
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
        e.preventDefault();
        open();
      }
    },
  };
}
