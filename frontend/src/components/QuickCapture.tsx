import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createCapture } from "../api/captures";
import { clipUrl, importPdf } from "../api/imports";
import { useApp } from "../context/app-ctx";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

interface QuickCaptureProps {
  onClose: () => void;
}

function urlFromText(value: string): URL | null {
  const candidate = value.trim();
  if (!/^https?:\/\//i.test(candidate)) return null;
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}

function captureTitle(text: string, url: URL | null): string {
  if (url) return url.hostname.replace(/^www\./, "");
  return text.trim().split("\n")[0]?.slice(0, 100) || "Quick capture";
}

/** Fast, keyboard-first ingress for a thought or a single URL. */
export function QuickCapture({ onClose }: QuickCaptureProps): ReactNode {
  const { pushToast, setTab, config } = useApp();
  const storageKey = `loom:quick-capture:v1:${config?.active_vault ?? "default"}`;
  const [draft, setDraft] = useState(() => {
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem(storageKey) ?? "null",
      );
      if (
        saved &&
        typeof saved === "object" &&
        "body" in saved &&
        typeof saved.body === "string" &&
        "title" in saved &&
        typeof saved.title === "string" &&
        "id" in saved &&
        typeof saved.id === "string"
      )
        return { body: saved.body, title: saved.title, id: saved.id };
    } catch {
      /* Show a fresh composer when saved JSON is unavailable. */
    }
    return { body: "", title: "", id: crypto.randomUUID() };
  });
  const { body, title } = draft;
  const [fetchPage, setFetchPage] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [storageError, setStorageError] = useState("");
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, []);
  const changeDraft = (update: Partial<typeof draft>) => {
    const next = { ...draft, ...update };
    setDraft(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setStorageError("");
    } catch {
      setStorageError(
        "Browser storage is unavailable. Keep this composer open until the capture is saved.",
      );
    }
  };
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if ((!body.trim() && !file) || saving) return;
    setSaving(true);
    setError(null);
    const url = urlFromText(body);
    const ctrl = new AbortController();
    request.current = ctrl;
    try {
      const response = file
        ? await importPdf(
            file,
            title || file.name.replace(/\.pdf$/i, ""),
            ctrl.signal,
          )
        : url && fetchPage
          ? await clipUrl(url.toString(), title, ctrl.signal)
          : await createCapture(
              {
                title: title.trim() || captureTitle(body, url),
                body,
                source: "manual:quick-capture",
                external_id: draft.id,
                ...(url ? { provenance: { url: url.toString() } } : {}),
              },
              ctrl.signal,
            );
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* Capture is durable in the vault. */
      }
      if (!mounted.current) return;
      pushToast({
        icon: "↓",
        agent: "weaver",
        body: response.deduplicated
          ? "That capture is already in the Inbox."
          : "Captured to the Inbox.",
      });
      setTab("inbox");
      onClose();
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : "Could not save capture");
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent
        className="sm:max-w-lg"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            void submit();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Quick capture</DialogTitle>
          <DialogDescription>
            A thought, a link or a PDF, straight to the Inbox.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="quick-capture-body">Thought or URL</Label>
          <Textarea
            id="quick-capture-body"
            autoFocus
            aria-label="Capture content"
            value={body}
            onChange={(event) => changeDraft({ body: event.target.value })}
            disabled={saving || Boolean(file)}
            placeholder="Paste a link or write a thought…"
            className="min-h-28"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="quick-capture-title">Title (optional)</Label>
          <Input
            id="quick-capture-title"
            aria-label="Capture title"
            value={title}
            onChange={(event) => changeDraft({ title: event.target.value })}
            disabled={saving}
            placeholder="A short handle for later"
          />
        </div>
        {urlFromText(body) && !file && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={fetchPage}
              onCheckedChange={(v) => setFetchPage(v === true)}
              disabled={saving}
            />
            Fetch page text and preserve the original
          </label>
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor="quick-capture-pdf">Or import a PDF</Label>
          <Input
            id="quick-capture-pdf"
            type="file"
            accept="application/pdf,.pdf"
            disabled={saving}
            onChange={(event) => {
              const selected = event.target.files?.[0] ?? null;
              if (selected && selected.size > 8 * 1024 * 1024) {
                setError("Choose a PDF smaller than 8 MiB.");
                event.target.value = "";
                return;
              }
              setFile(selected);
              setError(null);
            }}
          />
        </div>
        {file && (
          <p className="flex items-center gap-2 text-sm">
            {file.name}
            <Button
              variant="link"
              size="xs"
              className="h-auto p-0"
              disabled={saving}
              onClick={() => setFile(null)}
            >
              Remove file
            </Button>
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Imports support public web pages and text-based PDFs up to 8 MiB / 100
          pages. Scans need OCR. Text drafts stay in this browser until
          captured.
        </p>
        {storageError && (
          <p role="alert" className="text-sm text-warning-foreground">
            {storageError}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger-foreground">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={(!body.trim() && !file) || saving}
            onClick={() => void submit()}
          >
            {saving ? "Capturing…" : "Capture"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
