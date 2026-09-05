import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createCapture } from "../api/captures";
import { clipUrl, importPdf } from "../api/imports";
import { useApp } from "../context/app-ctx";
import { useFocusTrap } from "./useFocusTrap";
import "../styles/components/revisions.css";

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
  const dialogRef = useFocusTrap<HTMLDivElement>({
    onEscape: () => {
      if (!saving) onClose();
    },
    skipInitialFocus: true,
  });

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
    <div className="settings-modal-backdrop" role="presentation">
      <div
        ref={dialogRef}
        className="settings-modal quick-capture"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-capture-title"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            void submit();
          }
        }}
      >
        <div className="settings-kicker">Inbox</div>
        <h2 id="quick-capture-title" className="settings-modal-title">
          Quick capture
        </h2>
        <label className="note-modal-field">
          <span className="note-modal-label">Thought or URL</span>
          <textarea
            autoFocus
            className="input quick-capture-body"
            aria-label="Capture content"
            value={body}
            onChange={(event) => changeDraft({ body: event.target.value })}
            disabled={saving || Boolean(file)}
            placeholder="Paste a link or write a thought…"
          />
        </label>
        <label className="note-modal-field">
          <span className="note-modal-label">Title (optional)</span>
          <input
            className="input"
            aria-label="Capture title"
            value={title}
            onChange={(event) => changeDraft({ title: event.target.value })}
            disabled={saving}
            placeholder="A short handle for later"
          />
        </label>
        {urlFromText(body) && !file && (
          <label>
            <input
              type="checkbox"
              checked={fetchPage}
              onChange={(event) => setFetchPage(event.target.checked)}
              disabled={saving}
            />{" "}
            Fetch page text and preserve the original
          </label>
        )}
        <label className="note-modal-field">
          <span className="note-modal-label">Or import a PDF</span>
          <input
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
        </label>
        {file && (
          <p>
            {file.name} ·{" "}
            <button
              type="button"
              disabled={saving}
              onClick={() => setFile(null)}
            >
              Remove file
            </button>
          </p>
        )}
        <p className="settings-copy">
          Imports support public web pages and text-based PDFs up to 8 MiB / 100
          pages. Scans need OCR. Text drafts stay in this browser until
          captured.
        </p>
        {storageError && <p role="alert">{storageError}</p>}
        {error && (
          <div className="settings-test-result fail" role="alert">
            {error}
          </div>
        )}
        <div className="settings-actions">
          <button
            className="btn btn-md"
            type="button"
            disabled={saving}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="btn btn-md btn-amber"
            type="button"
            disabled={(!body.trim() && !file) || saving}
            onClick={() => void submit()}
          >
            {saving ? "Capturing…" : "Capture"}
          </button>
        </div>
      </div>
    </div>
  );
}
