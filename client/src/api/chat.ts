import { http } from './http';
import type { ChatContext, ConversationPayload, ConversationResponse } from '../types';

type ConversationsListResponse = {
  conversations: ConversationPayload[];
};

type ChatReplyResponse = {
  reply: string;
  sessionId: string;
  conversation: ConversationPayload;
};

export async function listConversations(): Promise<ConversationPayload[]> {
  const { data } = await http.get<ConversationsListResponse>('/api/conversations');
  return data.conversations ?? [];
}

export async function fetchConversationTranscript(sessionId: string): Promise<ConversationResponse> {
  const { data } = await http.get<ConversationResponse>(`/api/conversations/${sessionId}`);
  return data;
}

export async function sendChatMessage(payload: {
  message: string;
  sessionId: string;
  context?: ChatContext;
}): Promise<ChatReplyResponse> {
  const { data } = await http.post<ChatReplyResponse>('/api/chat', payload);
  return data;
}
