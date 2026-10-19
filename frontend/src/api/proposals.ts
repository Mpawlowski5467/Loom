import { ApiError, apiClient } from "./client";
import { MOCKS_ENABLED } from "./mocks";
import { mockCaptureProposals } from "./mocks/proposals";
import type { Capture } from "@/data/types";

/** One line of Sentinel's pre-check on a proposal. */
export interface PrecheckItem {
  rule: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

/** A stored Weaver proposal's state for one capture. */
export interface CaptureProposal {
  capture_id: string;
  /** Weaver has a proposal ready (no LLM call needed to show it). */
  ready: boolean;
  precheck: PrecheckItem[];
}

/**
 * Stored proposals for the Inbox. `null` when the backend can't say.
 *
 * BACKEND GAP (docs/ui-backend-gaps.md §11): `GET /api/captures/proposals`
 * doesn't exist; proposals are computed on demand by the preview endpoint
 * and have no Sentinel pre-check. Mocked with VITE_LOOM_MOCKS.
 */
export async function listCaptureProposals(
  captures: readonly Capture[],
  signal?: AbortSignal,
): Promise<Map<string, CaptureProposal> | null> {
  if (MOCKS_ENABLED) return mockCaptureProposals(captures);
  try {
    const rows = await apiClient.get<CaptureProposal[]>(
      "/api/captures/proposals",
      signal,
    );
    return new Map(rows.map((r) => [r.capture_id, r]));
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 405))
      return null;
    throw err;
  }
}
