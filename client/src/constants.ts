import { ChatMessage } from './types';

export const DEFAULT_ASSISTANT_MESSAGE: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content: 'Hi! I can dig into Polygon + Massive data for any ticker, strategy, or risk question. Just say what you need.',
  timestamp: Date.now(),
};
