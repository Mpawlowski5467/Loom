import { Archive, MoreHorizontal, Pencil } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface RowMenuProps {
  /** The row's name, for the trigger's accessible label. */
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  renameLabel: string;
  onRename: () => void;
  onArchive: () => void;
}

/** Rename / archive for one tree row; also opens on right-click. */
export function RowMenu(p: RowMenuProps) {
  // Rename swaps the row for an input: don't pull focus back to the trigger.
  const keepFocus = useRef(false);
  return (
    <DropdownMenu open={p.open} onOpenChange={p.onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Actions for ${p.name}`}
          className="absolute top-0.5 right-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
        >
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        onCloseAutoFocus={(e) => {
          if (keepFocus.current) e.preventDefault();
          keepFocus.current = false;
        }}
      >
        <DropdownMenuItem
          onSelect={() => {
            keepFocus.current = true;
            p.onRename();
          }}
        >
          <Pencil aria-hidden="true" />
          {p.renameLabel}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={p.onArchive}>
          <Archive aria-hidden="true" />
          Archive
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
