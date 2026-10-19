import { ApiError, apiClient } from "./client";
import { MOCKS_ENABLED } from "./mocks";
import { mockDraftSection } from "./mocks/notes";

export interface DraftSectionRequest {
  note_id: string;
  heading: string;
  /** The text already under the heading, as context. */
  context?: string;
}

/** Thrown when the backend has no route for a feature yet. */
export class EndpointMissingError extends Error {
  constructor(feature: string) {
    super(`${feature} needs a backend endpoint that doesn't exist yet.`);
    this.name = "EndpointMissingError";
  }
}

/**
 * Ask Weaver to draft a section. Read-only: returns markdown for the editor
 * to insert; the normal save path writes it.
 *
 * BACKEND GAP (docs/ui-backend-gaps.md §7): `POST /api/agents/weaver/draft`
 * doesn't exist. Mocked with VITE_LOOM_MOCKS.
 */
export async function draftSection(req: DraftSectionRequest): Promise<string> {
  if (MOCKS_ENABLED) return mockDraftSection(req.heading);
  try {
    const res = await apiClient.post<{ markdown: string }>(
      "/api/agents/weaver/draft",
      req,
      undefined,
      120_000,
    );
    return res.markdown;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 405))
      throw new EndpointMissingError("Drafting with Weaver");
    throw err;
  }
}
