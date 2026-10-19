import { Loader2 } from "lucide-react";
import { useState } from "react";
import { createCapture } from "@/api/captures";
import { describeApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useApp } from "@/context/app-ctx";

/** A link alone is kept as the capture's source URL too. */
function urlOf(text: string): string | null {
  const t = text.trim();
  if (!/^https?:\/\/\S+$/i.test(t)) return null;
  try {
    return new URL(t).toString();
  } catch {
    return null;
  }
}

/** Capture without leaving the Inbox; ⌘↵ sends. More opens the full dialog. */
export function InlineCapture() {
  const { pushToast, setQuickCaptureOpen } = useApp();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    const url = urlOf(body);
    try {
      const res = await createCapture({
        title: url
          ? new URL(url).hostname.replace(/^www\./, "")
          : body.split("\n")[0]!.slice(0, 100),
        body,
        source: "manual:inbox",
        ...(url ? { provenance: { url } } : {}),
      });
      setText("");
      pushToast({
        icon: "✓",
        agent: "weaver",
        body: res.deduplicated
          ? "That capture is already in the Inbox."
          : "Captured to the Inbox.",
      });
    } catch (err) {
      setError(describeApiError(err, "Could not save capture"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="flex flex-col gap-2 border-b border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Textarea
        aria-label="Quick capture"
        placeholder="Capture a thought or paste a link…"
        value={text}
        rows={2}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        className="max-h-32 min-h-14 resize-none text-sm"
      />
      {error && (
        <p role="alert" className="text-xs text-danger-foreground">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="link"
          size="xs"
          className="h-auto p-0 text-xs"
          onClick={() => setQuickCaptureOpen(true)}
        >
          Title, page fetch or PDF…
        </Button>
        <Button
          type="submit"
          size="sm"
          className="ml-auto"
          disabled={busy || !text.trim()}
        >
          {busy && <Loader2 aria-hidden="true" className="animate-spin" />}
          Capture
        </Button>
      </div>
    </form>
  );
}
