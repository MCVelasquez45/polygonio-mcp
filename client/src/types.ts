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

export type ChatContext = {
  view?: 'trading' | 'scanner' | 'portfolio' | 'dashboard';
  selectedTicker?: string;
  chart?: {
    symbol?: string;
    timeframe?: string;
    barCount?: number;
    lastClose?: number | null;
    underlyingPrice?: number | null;
    indicators?: { name: string; latest?: number | null; trend?: string | null }[];
  };
  option?: {
    ticker?: string;
    underlying?: string;
    expiration?: string;
    strike?: number;
    type?: string;
    iv?: number | null;
    openInterest?: number | null;
    greeks?: {
      delta?: number | null;
      gamma?: number | null;
      theta?: number | null;
      vega?: number | null;
      rho?: number | null;
    };
  };
  market?: {
    state?: string;
    marketClosed?: boolean;
    afterHours?: boolean;
  };
  watchlist?: string[];
};
