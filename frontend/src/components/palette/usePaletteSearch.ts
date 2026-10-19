import { useEffect, useState } from "react";
import { describeApiError } from "@/api/client";
import { searchVault, type VaultSearch } from "@/api/search";

const DEBOUNCE_MS = 120;

export type PaletteSearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; search: VaultSearch }
  | { status: "error"; message: string };

/**
 * Debounced hybrid search for the palette. A newer query aborts the older
 * request, and a result only shows for the inputs that produced it.
 */
export function usePaletteSearch(
  query: string,
  context: string | null,
  includeSuperseded: boolean,
): PaletteSearchState {
  const trimmed = query.trim();
  const key = `${trimmed}\u0000${context ?? ""}\u0000${includeSuperseded}`;
  const [result, setResult] = useState<{
    key: string;
    state: PaletteSearchState;
  } | null>(null);

  useEffect(() => {
    if (!trimmed) return;
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      searchVault(trimmed, {
        context,
        includeSuperseded,
        signal: ctrl.signal,
      }).then(
        (search) =>
          !ctrl.signal.aborted &&
          setResult({ key, state: { status: "ok", search } }),
        (err: unknown) =>
          !ctrl.signal.aborted &&
          setResult({
            key,
            state: {
              status: "error",
              message: describeApiError(err, "Search failed"),
            },
          }),
      );
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [key, trimmed, context, includeSuperseded]);

  if (!trimmed) return { status: "idle" };
  return result?.key === key ? result.state : { status: "loading" };
}
