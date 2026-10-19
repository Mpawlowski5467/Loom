import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { fetchTrace } from "../api/traces";
import type { TraceDetail } from "../api/traces";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";
import { cn } from "@/lib/utils";

interface Props {
  traceId: string;
  onClose: () => void;
}

/** The raw-call inspector: one traced LLM call's prompt, messages, reply. */
export function TraceModal({ traceId, onClose }: Props): ReactNode {
  // Tag the result with its traceId so a stale fetch never renders against a
  // newer id — lets us avoid resetting state synchronously inside the effect.
  const [result, setResult] = useState<{
    id: string;
    trace: TraceDetail | null;
    error: string | null;
  }>({ id: "", trace: null, error: null });

  useEffect(() => {
    let cancelled = false;
    fetchTrace(traceId)
      .then((t) => {
        if (!cancelled) setResult({ id: traceId, trace: t, error: null });
      })
      .catch((e) => {
        if (!cancelled) {
          setResult({
            id: traceId,
            trace: null,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [traceId]);

  const current = result.id === traceId ? result : null;
  const trace = current?.trace ?? null;
  const error = current?.error ?? null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-4 overflow-y-auto sm:max-w-3xl">
        <DialogTitle>LLM call</DialogTitle>
        <DialogDescription className="sr-only">
          The prompt, messages and response of one model call.
        </DialogDescription>
        {error && (
          <p role="alert" className="text-sm text-danger-foreground">
            Error: {error}
          </p>
        )}
        {!trace && !error && (
          <p role="status" className="text-sm text-muted-foreground">
            Loading…
          </p>
        )}
        {trace && (
          <div className="flex flex-col gap-4">
            <Meta trace={trace} />
            {trace.content_retained === false && (
              <p className="text-sm text-muted-foreground">
                Prompt and response content was withheld by the privacy policy.
                Only call metadata was retained.
              </p>
            )}
            <Section label="System prompt" body={trace.system || "(none)"} />
            {trace.messages.map((m, i) => (
              <Section
                key={i}
                label={`Message ${i + 1} — ${m.role}`}
                body={m.content}
              />
            ))}
            <Section
              label={trace.error ? "Error" : "Response"}
              body={trace.error || trace.response}
              danger={!!trace.error}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Meta({ trace }: { trace: TraceDetail }): ReactNode {
  const items: [string, string][] = [
    ["caller", trace.caller || "—"],
    ["provider", trace.provider],
    ["model", trace.model || "—"],
    ["latency", `${trace.duration_ms} ms`],
    ["at", new Date(trace.timestamp).toLocaleString()],
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="font-mono text-[11px] text-muted-foreground uppercase">
            {k}
          </dt>
          <dd className="truncate text-sm text-foreground" title={v}>
            {v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Section({
  label,
  body,
  danger,
}: {
  label: string;
  body: string;
  danger?: boolean;
}): ReactNode {
  return (
    <section className="flex flex-col gap-1">
      <h4 className="font-mono text-[11px] text-muted-foreground uppercase">
        {label}
      </h4>
      <pre
        className={cn(
          "max-h-72 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap",
          danger ? "text-danger-foreground" : "text-secondary-foreground",
        )}
      >
        {body}
      </pre>
    </section>
  );
}
