export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
};

export type ConversationMeta = {
  id: string;
  sessionId: string;
  title: string;
  preview: string;
  createdAt: number;
  updatedAt: number;
};

export type ConversationPayload = {
  sessionId: string;
  title: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
};

export type ConversationResponse = ConversationPayload & {
  messages: {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
  }[];
};
