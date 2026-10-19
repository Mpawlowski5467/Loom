import { ExternalLink } from "lucide-react";
import { formatDateTime } from "@/data/formatDate";
import type { Capture } from "@/data/types";
import { sourceLabel } from "./captureSource";

/** Source line, title and provenance (a source URL opens in a new tab). */
export function CaptureHeader({ capture: c }: { capture: Capture }) {
  const provenance = Object.entries(c.provenance ?? {});
  return (
    <header className="flex flex-col gap-2">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="rounded-sm bg-chip px-1.5 py-0.5 font-medium text-chip-foreground">
          {sourceLabel(c.source)}
        </span>
        {c.source && <span className="font-mono">via {c.source}</span>}
        <span>· received {formatDateTime(c.receivedAt)}</span>
        <span className="font-mono">· {c.folder}/</span>
      </p>
      <h1 id="capture-title" className="text-xl font-semibold text-foreground">
        {c.title}
      </h1>
      {provenance.length > 0 && (
        <dl
          aria-label="Capture provenance"
          className="flex flex-col gap-0.5 text-xs"
        >
          {provenance.map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="text-muted-foreground">
                {k.replaceAll("_", " ")}
              </dt>
              <dd className="min-w-0 truncate">
                {/^https?:\/\//i.test(v) ? (
                  <a
                    href={v}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-brand underline"
                  >
                    {v}
                    <ExternalLink aria-hidden="true" className="size-3" />
                  </a>
                ) : (
                  v
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </header>
  );
}
