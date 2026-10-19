import { ExternalLink } from "lucide-react";
import { API_BASE } from "@/api/client";

const LINKS = [
  ["Health", "/api/health"],
  ["Diagnostics", "/api/diagnostics"],
  ["LLM traces", "/api/traces"],
  ["Index stats", "/api/index/stats"],
] as const;

/** The raw JSON endpoints behind this page, each in a new tab. */
export function ApiLinks() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
      {LINKS.map(([label, path]) => (
        <a
          key={path}
          href={`${API_BASE}${path}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-sm text-brand underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          {label}
          <ExternalLink aria-hidden="true" className="size-3.5" />
        </a>
      ))}
    </div>
  );
}
