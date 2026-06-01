import type { ReactNode } from "react";

/**
 * Banner shown when notes exist in the file index but are missing from the
 * search vector store (index drift) — the backend is re-embedding them. Reuses
 * the shared `.banner` styling; pairs with the system-state `--agent` palette.
 */
export function UnindexedBanner({ count }: { count: number }): ReactNode {
  const noun = count === 1 ? "note" : "notes";
  return (
    <div className="banner banner-unindexed" role="status">
      <span className="banner-icon" aria-hidden="true">
        ↻
      </span>
      <span className="banner-body">
        {count} {noun} not yet indexed — rebuilding search…
      </span>
    </div>
  );
}
