import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

/** A value to paste elsewhere (redirect URI, device code) that copies on click. */
export function CopyChip({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return; // clipboard unavailable (permissions) — leave the state unchanged
    }
    setCopied(true);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      className="h-auto min-h-6 max-w-full py-0.5 text-left align-middle whitespace-normal"
      onClick={() => void copy()}
      title={copied ? "Copied" : "Copy"}
    >
      <code className="min-w-0 font-mono break-all text-secondary-foreground">
        {text}
      </code>
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      <span className="text-muted-foreground">
        {copied ? "Copied" : "Copy"}
      </span>
    </Button>
  );
}
