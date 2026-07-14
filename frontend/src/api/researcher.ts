import { apiClient } from "./client";

export interface ResearcherReference {
  note_id: string;
  title: string;
  path?: string;
  heading?: string;
  snippet?: string;
  score?: number;
  type?: string;
}

export interface ResearcherQueryResponse {
  answer: string;
  referenced_notes: ResearcherReference[];
  capture_id: string;
  capture_path: string;
  saved_to_inbox: boolean;
}

interface ResearcherQueryOptions {
  saveCapture?: boolean;
  persistChat?: boolean;
  signal?: AbortSignal;
}

/**
 * Ask Researcher to synthesize an answer from vault evidence.
 *
 * Previewing is intentionally the default: a query only writes a capture when
 * the caller explicitly opts into ``saveCapture``.
 */
export function queryResearcher(
  question: string,
  {
    saveCapture = false,
    persistChat = false,
    signal,
  }: ResearcherQueryOptions = {},
): Promise<ResearcherQueryResponse> {
  return apiClient.post<ResearcherQueryResponse>(
    "/api/agents/researcher/query",
    {
      question,
      save_capture: saveCapture,
      persist_chat: persistChat,
    },
    signal,
    120_000,
  );
}
