import { useEffect, useState } from "react";
import { listCaptureProposals, type CaptureProposal } from "@/api/proposals";
import type { Capture } from "@/data/types";

/**
 * Stored proposals for waiting captures (gap 11), refetched when the set of
 * waiting captures changes. null when the backend has none.
 */
export function useProposals(captures: readonly Capture[], enabled: boolean) {
  const [map, setMap] = useState<Map<string, CaptureProposal> | null>(null);
  const waiting = captures.filter((c) => c.status === "pending");
  const key = waiting
    .map((c) => c.id)
    .sort()
    .join(",");
  useEffect(() => {
    if (!enabled || !key) return;
    const ctrl = new AbortController();
    listCaptureProposals(waiting, ctrl.signal).then(
      (m) => !ctrl.signal.aborted && setMap(m),
      () => {},
    );
    return () => ctrl.abort();
    // `key` stands in for the waiting captures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);
  return map;
}
