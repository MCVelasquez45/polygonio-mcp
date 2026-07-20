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

export async function listConversations(symbol?: string): Promise<ConversationPayload[]> {
  const { data } = await http.get<ConversationsListResponse>('/api/conversations', {
    params: symbol ? { symbol } : undefined,
  });
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
  /** Run a server-side AI Desk agent (full data package) instead of a raw prompt. */
  agentId?: string;
}): Promise<ChatReplyResponse> {
  const { data } = await http.post<ChatReplyResponse>('/api/chat', payload);
  return data;
}

export type AiAgentSummary = {
  id: string;
  label: string;
  description: string;
  contexts: string[];
};

export async function listAiAgents(): Promise<AiAgentSummary[]> {
  const { data } = await http.get<{ agents: AiAgentSummary[] }>('/api/chat/agents');
  return data.agents ?? [];
}

export async function deleteConversation(sessionId: string): Promise<void> {
  await http.delete(`/api/conversations/${sessionId}`);
}

export async function saveChatReport(payload: {
  content: string;
  title?: string;
  sessionId?: string;
  context?: ChatContext;
}): Promise<{ result: string }> {
  const { data } = await http.post<{ result: string }>('/api/chat/report', payload);
  return data;
}
