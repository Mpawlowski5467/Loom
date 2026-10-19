import {
  CalendarDays,
  FolderKanban,
  Hash,
  Inbox,
  User,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Kbd } from "@/components/shell/Kbd";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { createNote, getTree, type NoteRecord } from "../api/notes";
import { NewNoteTags } from "./newnote/NewNoteTags";
import {
  cleanTag,
  collectFolderPaths,
  FOLDER_AUTO,
  TYPE_OPTIONS,
} from "./newnote/noteTypes";

interface Props {
  onClose: () => void;
  onCreated: (note: NoteRecord) => void;
  initialTitle?: string;
}

const TYPE_ICON: Record<string, LucideIcon> = {
  topic: Hash,
  project: FolderKanban,
  person: User,
  daily: CalendarDays,
  capture: Inbox,
};

const LABEL = "text-sm font-medium text-foreground";

/** Create a note: title, type, folder and tags; ⌘↵ creates it. */
export function NewNoteModal({
  onClose,
  onCreated,
  initialTitle,
}: Props): ReactNode {
  const [title, setTitle] = useState(initialTitle ?? "");
  const [type, setType] = useState<string>("topic");
  const [folder, setFolder] = useState<string>(FOLDER_AUTO);
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [folders, setFolders] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getTree()
      .then((tree) => {
        if (!cancelled) setFolders(collectFolderPaths(tree));
      })
      .catch(() => {
        // Tree unreachable: fall back to the type's default folder.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const trimmedTitle = title.trim();
  const canSubmit = trimmedTitle.length > 0 && !busy;
  const defaultFolderForType =
    TYPE_OPTIONS.find((t) => t.value === type)?.defaultFolder ?? "topics";

  const commitTag = () => {
    const t = cleanTag(tagDraft);
    if (t && !tags.includes(t)) setTags((prev) => [...prev, t]);
    setTagDraft("");
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      // A tag still sitting in the draft box counts: ⌘↵ mustn't drop it.
      const draft = cleanTag(tagDraft);
      const allTags = draft && !tags.includes(draft) ? [...tags, draft] : tags;
      const note = await createNote({
        title: trimmedTitle,
        type,
        tags: allTags,
        // FOLDER_AUTO → empty string → the backend picks the type's folder.
        folder: folder === FOLDER_AUTO ? "" : folder,
      });
      onCreated(note);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        aria-modal="true"
        aria-describedby={undefined}
        className="gap-5 sm:max-w-lg"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Create a note</DialogTitle>
        </DialogHeader>

        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Title</span>
          <Input
            value={title}
            placeholder="A short, declarative name"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className={LABEL} id="new-note-type-label">
            Type
          </span>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            role="radiogroup"
            aria-labelledby="new-note-type-label"
            value={type}
            onValueChange={(v) => v && setType(v)}
            className="flex-wrap"
          >
            {TYPE_OPTIONS.map((opt) => {
              const Icon = TYPE_ICON[opt.value] ?? Hash;
              return (
                <ToggleGroupItem
                  key={opt.value}
                  value={opt.value}
                  className="gap-1.5 px-3 text-xs"
                >
                  <Icon aria-hidden="true" />
                  {opt.label}
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Folder</span>
          <NativeSelect
            className="font-mono"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
          >
            <option value={FOLDER_AUTO}>
              — default ({defaultFolderForType}) —
            </option>
            {folders.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </NativeSelect>
        </label>

        <div className="flex flex-col gap-1.5">
          <span className={LABEL}>Tags</span>
          <NewNoteTags
            tags={tags}
            draft={tagDraft}
            onDraftChange={setTagDraft}
            onCommit={commitTag}
            onRemove={(t) => setTags((prev) => prev.filter((x) => x !== t))}
            onRemoveLast={() => setTags((prev) => prev.slice(0, -1))}
          />
        </div>

        {error && (
          <p role="status" className="text-sm text-danger-foreground">
            {error}
          </p>
        )}

        <DialogFooter className="items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Weaver files it into the vault · <Kbd>⌘</Kbd> <Kbd>↵</Kbd> to create
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!canSubmit} onClick={() => void submit()}>
              {busy ? "Creating…" : "Create note"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
