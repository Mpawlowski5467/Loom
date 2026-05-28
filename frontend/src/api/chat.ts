import { API_BASE, ApiError, apiClient } from "./client";

export interface ChatMessageResponse {
  role: string;
  content: string;
  timestamp: string;
  agent: string;
}

export interface AgentContribution {
  agent: string;
  content: string;
  trace_id: string;
  error: string;
}

export interface ChatHistoryResponse {
  agent: string;
  messages: ChatMessageResponse[];
}

export function loadChatHistory(
  agent: string = "_council",
  limit: number = 20,
): Promise<ChatHistoryResponse> {
  return apiClient.get<ChatHistoryResponse>(
    `/api/chat/history?agent=${encodeURIComponent(agent)}&limit=${limit}`,
  );
}

/** One frame from the council SSE stream. */
export type CouncilStreamEvent =
  | { kind: "contributions"; contributions: AgentContribution[] }
  | { kind: "token"; chunk: string }
  | {
      kind: "done";
      assistantText: string;
      traceId: string;
      contributions: AgentContribution[];
    }
  | { kind: "error"; message: string };

interface CouncilStreamOptions {
  signal?: AbortSignal;
  onEvent: (event: CouncilStreamEvent) => void;
}

/**
 * POST a council message and consume the resulting Server-Sent Event stream.
 *
 * Caller supplies ``onEvent`` to react to each chunk as it arrives. The
 * returned promise resolves when the stream ends (a ``done`` or ``error``
 * event has been emitted, or the connection closes).
 */
export async function streamCouncilMessage(
  message: string,
  { signal, onEvent }: CouncilStreamOptions,
): Promise<void> {
  const resp = await fetch(`${API_BASE}/api/chat/send/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ message, agent: "_council" }),
    signal,
  });
  if (!resp.ok || !resp.body) {
    let detail = resp.statusText || "Stream failed";
    try {
      const payload = await resp.json();
      if (payload && typeof payload === "object") {
        const d = (payload as Record<string, unknown>)["detail"];
        if (typeof d === "string") detail = d;
      }
    } catch {
      // ignore body parse failure
    }
    throw new ApiError(detail, resp.status);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const parsed = parseSseFrame(frame);
        if (parsed) onEvent(parsed);
      }
    }
    // Flush any trailing frame the server didn't terminate with \n\n.
    if (buffer.trim()) {
      const parsed = parseSseFrame(buffer);
      if (parsed) onEvent(parsed);
    }
  } finally {
    reader.releaseLock();
  }
}

function parseSseFrame(frame: string): CouncilStreamEvent | null {
  const lines = frame.split("\n");
  let event = "";
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!event) return null;
  const data = dataLines.join("\n");
  switch (event) {
    case "contributions": {
      try {
        const parsed = JSON.parse(data) as {
          agent_contributions: AgentContribution[];
        };
        return { kind: "contributions", contributions: parsed.agent_contributions };
      } catch {
        return null;
      }
    }
    case "token": {
      // Token data is a raw JSON string (e.g. `"hello"`); fall back to raw text
      // if the server ever omits the JSON quotes.
      try {
        const parsed = JSON.parse(data);
        return { kind: "token", chunk: typeof parsed === "string" ? parsed : String(parsed) };
      } catch {
        return { kind: "token", chunk: data };
      }
    }
    case "done": {
      try {
        const parsed = JSON.parse(data) as {
          assistant_text: string;
          trace_id: string;
          agent_contributions: AgentContribution[];
        };
        return {
          kind: "done",
          assistantText: parsed.assistant_text,
          traceId: parsed.trace_id,
          contributions: parsed.agent_contributions,
        };
      } catch {
        return null;
      }
    }
    case "error": {
      try {
        const parsed = JSON.parse(data) as { message: string };
        return { kind: "error", message: parsed.message };
      } catch {
        return { kind: "error", message: data };
      }
    }
    default:
      return null;
  }
}
