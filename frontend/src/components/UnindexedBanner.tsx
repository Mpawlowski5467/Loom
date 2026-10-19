import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Banner shown when notes exist in the file index but are missing from the
 * search vector store (index drift) — the backend is re-embedding them.
 * Matches the shell's info banners (`shell/Banners.tsx`).
 */
export function UnindexedBanner({ count }: { count: number }): ReactNode {
  const noun = count === 1 ? "note" : "notes";
  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-banner-border bg-banner px-4 py-1.5 text-sm text-banner-foreground"
    >
      <span aria-hidden="true" className="[&_svg]:size-4">
        <RefreshCw />
      </span>
      <span>
        {count} {noun} not yet indexed — rebuilding search…
      </span>
    </div>
  );
}
