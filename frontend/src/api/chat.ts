import { apiClient } from "./client";

export interface ChatMessageResponse {
  role: string;
  content: string;
  timestamp: string;
  agent: string;
}

export interface SendMessageResponse {
  user_message: ChatMessageResponse;
  assistant_message: ChatMessageResponse;
  trace_id: string;
}

export interface ChatHistoryResponse {
  agent: string;
  messages: ChatMessageResponse[];
}

export function sendChatMessage(
  message: string,
  agent: string = "_council",
): Promise<SendMessageResponse> {
  return apiClient.post<SendMessageResponse>("/api/chat/send", {
    message,
    agent,
  });
}

export function loadChatHistory(
  agent: string = "_council",
  limit: number = 20,
): Promise<ChatHistoryResponse> {
  return apiClient.get<ChatHistoryResponse>(
    `/api/chat/history?agent=${encodeURIComponent(agent)}&limit=${limit}`,
  );
}
