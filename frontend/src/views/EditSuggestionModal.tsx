import { useState } from "react";
import type { ReactNode } from "react";
import type { Capture } from "../data/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  captureRelPath,
  commitCapture,
  previewCapture,
  type CapturePreview,
  type CommitResult,
} from "../api/captures";

interface Props {
  capture: Capture;
  /** The already-fetched preview, used to prefill the form. */
  preview?: CapturePreview;
  onClose: () => void;
  onAccepted: (result: CommitResult) => void;
}

const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "topic", label: "Topic" },
  { value: "project", label: "Project" },
  { value: "person", label: "Person" },
  { value: "daily", label: "Daily" },
  { value: "capture", label: "Capture" },
];

/** The UI carries the frontend ``people``; the backend speaks ``person``. */
function toBackendType(t: string): string {
  return t === "people" ? "person" : t;
}

export function EditSuggestionModal({
  capture,
  preview,
  onClose,
  onAccepted,
}: Props): ReactNode {
  const sug = capture.suggestion;
  const initialType = toBackendType(preview?.note_type ?? sug?.type ?? "topic");
  const initialTitle = preview?.title ?? sug?.title ?? capture.title;
  const initialFolder = preview?.folder ?? sug?.destFolder ?? capture.folder;
  const initialTags = (preview?.tags ?? sug?.tags ?? []).join(", ");

  const [title, setTitle] = useState(initialTitle);
  const [type, setType] = useState(initialType);
  const [folder, setFolder] = useState(initialFolder);
  const [tagsInput, setTagsInput] = useState(initialTags);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Inline confirmation for the dirty-discard guard (a second modal can't
  // take focus from inside this dialog).
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const trimmedTitle = title.trim();
  const canSubmit = trimmedTitle.length > 0 && !busy;

  const dirty =
    title !== initialTitle ||
    type !== initialType ||
    folder !== initialFolder ||
    tagsInput !== initialTags;

  // Guard accidental dismissal (backdrop / Cancel / Esc) once edits exist.
  // With no unsaved edits, close immediately.
  const requestClose = () => {
    // While the discard confirm is up, its own Escape/Cancel owns dismissal —
    // don't let the focus-trap's window-level Escape re-open it.
    if (confirmDiscard) return;
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim().replace(/^#/, ""))
        .filter(Boolean);
      const path = captureRelPath(capture);
      // Re-preview with the edits so Weaver regenerates the body for the chosen
      // type, then file exactly what was regenerated (what-you-see-is-filed).
      const fresh = await previewCapture({
        capture_path: path,
        note_type: type,
        folder,
        title: trimmedTitle,
        tags,
      });
      if (!fresh) {
        setError("This capture is empty — nothing to file.");
        return;
      }
      const result = await commitCapture({
        capture_path: path,
        note_type: fresh.note_type,
        folder: fresh.folder,
        title: fresh.title,
        tags: fresh.tags,
        body: fresh.body,
      });
      onAccepted(result);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Filing failed");
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && requestClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit the proposal</DialogTitle>
          <DialogDescription>
            Override Weaver's classification before filing. Weaver regenerates
            the note body for the type you choose. ⌘↵ files it.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="edit-title">Title</Label>
          <Input
            id="edit-title"
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={onKey}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-type">Type</Label>
            <select
              id="edit-type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-folder">Folder</Label>
            <Input
              id="edit-folder"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              onKeyDown={onKey}
              className="font-mono text-xs"
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="edit-tags">Tags</Label>
          <Input
            id="edit-tags"
            value={tagsInput}
            placeholder="comma-separated, e.g. infra, perf"
            onChange={(e) => setTagsInput(e.target.value)}
            onKeyDown={onKey}
            className="font-mono text-xs"
          />
        </div>
        {error && (
          <p role="status" className="text-sm text-danger-foreground">
            {error}
          </p>
        )}
        {confirmDiscard ? (
          <section
            aria-labelledby="discard-edits"
            className="flex flex-col gap-2 rounded-md border border-warning-border bg-warning p-3 text-sm text-warning-foreground"
          >
            <h3 id="discard-edits" className="font-medium">
              Discard your changes to this suggestion?
            </h3>
            <p>Your edits to the title, type, folder and tags will be lost.</p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmDiscard(false)}
              >
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={onClose}>
                Discard
              </Button>
            </div>
          </section>
        ) : (
          <DialogFooter>
            <Button variant="outline" onClick={requestClose}>
              Cancel
            </Button>
            <Button disabled={!canSubmit} onClick={() => void submit()}>
              {busy ? "Filing…" : "Approve and file"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
