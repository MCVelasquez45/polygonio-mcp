import { ChatMessage } from './types';

export const DEFAULT_ASSISTANT_MESSAGE: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content: 'Hi! Ask me about a ticker, strategy, macro setup, or risk view and I will tap Polygon + FRED data for you.',
  timestamp: Date.now(),
};
