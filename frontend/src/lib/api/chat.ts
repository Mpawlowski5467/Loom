import { request } from "./common";

export interface ChatMessage {
  role: string;
  content: string;
  timestamp: string;
  agent: string;
}

export interface SendMessageResponse {
  user_message: ChatMessage;
  assistant_message: ChatMessage;
}

export interface ChatHistoryResponse {
  agent: string;
  messages: ChatMessage[];
}

export interface ChatSessionList {
  agent: string;
  sessions: string[];
}

export function sendChatMessage(
  message: string,
  agent: string = "_council",
): Promise<SendMessageResponse> {
  return request<SendMessageResponse>("/api/chat/send", {
    method: "POST",
    body: JSON.stringify({ message, agent }),
  });
}

export function fetchChatHistory(
  agent: string = "_council",
  limit: number = 20,
): Promise<ChatHistoryResponse> {
  const query = new URLSearchParams({ agent, limit: String(limit) });
  return request<ChatHistoryResponse>(`/api/chat/history?${query.toString()}`);
}

export function fetchChatHistoryByDate(
  dateStr: string,
  agent: string = "_council",
): Promise<ChatHistoryResponse> {
  const query = new URLSearchParams({ agent });
  return request<ChatHistoryResponse>(
    `/api/chat/history/${encodeURIComponent(dateStr)}?${query.toString()}`,
  );
}

export function fetchChatSessions(agent: string = "_council"): Promise<ChatSessionList> {
  return request<ChatSessionList>(
    `/api/chat/sessions?agent=${encodeURIComponent(agent)}`,
  );
}
