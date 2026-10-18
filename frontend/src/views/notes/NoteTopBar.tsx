import {
  Archive,
  Code,
  History,
  MessagesSquare,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  Save,
} from "lucide-react";
import { Fragment } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Toggle } from "@/components/ui/toggle";
import { formatRelative } from "@/data/formatDate";
import type { Note } from "@/data/types";
import { useLastCommit } from "./useLastCommit";

interface NoteTopBarProps {
  note: Note;
  dirty: boolean;
  saving: boolean;
  sourceMode: boolean;
  onSourceModeChange: (on: boolean) => void;
  onSave: () => void;
  onHistory: () => void;
  onAskCouncil: () => void;
  onArchive: () => void;
  onOpenTree: () => void;
  onOpenRail: () => void;
}

/** Breadcrumb, last commit, save state and the note's actions. */
export function NoteTopBar(p: NoteTopBarProps) {
  const commit = useLastCommit(p.note);
  const crumbs = p.note.folder ? p.note.folder.split("/") : [];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2">
      <Button
        variant="ghost"
        size="icon-sm"
        className="lg:hidden"
        aria-label="Show vault"
        onClick={p.onOpenTree}
      >
        <PanelLeft aria-hidden="true" />
      </Button>
      <Breadcrumb className="min-w-0">
        <BreadcrumbList className="flex-nowrap">
          {crumbs.map((c) => (
            <Fragment key={c}>
              <BreadcrumbItem className="font-mono text-xs">{c}</BreadcrumbItem>
              <BreadcrumbSeparator />
            </Fragment>
          ))}
          <BreadcrumbItem className="min-w-0">
            <BreadcrumbPage className="truncate">{p.note.title}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      {commit && (
        <span
          className="hidden font-mono text-xs whitespace-nowrap text-muted-foreground sm:inline"
          title={commit.subject}
        >
          {commit.short_sha} · {formatRelative(commit.date)}
        </span>
      )}
      <div className="ml-auto flex items-center gap-1">
        {p.dirty ? (
          <Button
            size="sm"
            onClick={p.onSave}
            disabled={p.saving}
            aria-keyshortcuts="Meta+S Control+S"
          >
            <Save aria-hidden="true" />
            {p.saving ? "Saving…" : "Save"}
          </Button>
        ) : (
          <span className="px-2 text-xs text-muted-foreground">Saved</span>
        )}
        <Toggle
          size="sm"
          pressed={p.sourceMode}
          onPressedChange={p.onSourceModeChange}
          aria-label="Edit as markdown"
          title="Edit as markdown"
        >
          <Code aria-hidden="true" />
        </Toggle>
        <Button variant="ghost" size="sm" onClick={p.onHistory}>
          <History aria-hidden="true" />
          History
        </Button>
        <Button variant="ghost" size="sm" onClick={p.onAskCouncil}>
          <MessagesSquare aria-hidden="true" />
          Ask Council
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="More note actions"
            >
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={p.onArchive}>
              <Archive aria-hidden="true" />
              Archive note
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="icon-sm"
          className="lg:hidden"
          aria-label="Show note context"
          onClick={p.onOpenRail}
        >
          <PanelRight aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
