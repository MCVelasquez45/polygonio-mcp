import { http } from './http';

// Sprint 2E — the Automation Control Center API client. The server-side
// watchlist is the single source of truth for the automation universe; these
// endpoints curate it. Changes take effect with no server restart.

export type WatchlistStrategy =
  | 'OPTIONS_NATIVE_FLOW'
  | 'EQUITY_MOMENTUM'
  | 'VOLATILITY_BREAKOUT'
  | 'NEWS_EVENT'
  | 'GPT_RESEARCH_ONLY';

export type WatchlistAutomationStatus =
  | 'DISABLED'
  | 'WAITING_FOR_BASELINE'
  | 'MONITORING'
  | 'EVALUATING'
  | 'POSITION_OPEN';

export interface WatchlistItem {
  symbol: string;
  enabled: boolean;
  automationEnabled: boolean;
  priority: number;
  strategy: WatchlistStrategy;
  minConfidence: number;
  maxPositionSize: number;
  maxSpreadPercent: number;
  maxDTE: number;
  minDTE: number;
  notes?: string;
  automationStatus: WatchlistAutomationStatus;
  lastEvaluationAt: string | null;
  lastSignal: 'BULLISH' | 'BEARISH' | 'NO_TRADE' | 'DATA_REJECTED' | 'BASELINE' | null;
  lastSignalAt: string | null;
  lastTradeAt: string | null;
  updatedAt: string;
}

export interface AutomationUniverse {
  symbols: string[];
  items: Record<string, unknown>;
  skipped: { symbol: string; reason: string }[];
  empty: boolean;
  source: 'watchlist';
  loadedAt: number;
}

export async function listWatchlist(signal?: AbortSignal): Promise<WatchlistItem[]> {
  const { data } = await http.get<{ items: WatchlistItem[] }>('/api/watchlist', { signal });
  return data.items;
}

export async function getAutomationUniverse(signal?: AbortSignal): Promise<AutomationUniverse> {
  const { data } = await http.get<AutomationUniverse>('/api/watchlist/universe', { signal });
  return data;
}

export async function upsertWatchlistItem(input: Partial<WatchlistItem> & { symbol: string }): Promise<WatchlistItem> {
  const { data } = await http.post<WatchlistItem>('/api/watchlist', input);
  return data;
}

export async function updateWatchlistItem(symbol: string, patch: Partial<WatchlistItem>): Promise<WatchlistItem> {
  const { data } = await http.patch<WatchlistItem>(`/api/watchlist/${encodeURIComponent(symbol)}`, patch);
  return data;
}

export async function setAutomationEnabled(symbol: string, enabled: boolean): Promise<WatchlistItem> {
  const { data } = await http.post<WatchlistItem>(`/api/watchlist/${encodeURIComponent(symbol)}/automation`, { enabled });
  return data;
}

export async function setPriority(symbol: string, priority: number): Promise<WatchlistItem> {
  return updateWatchlistItem(symbol, { priority });
}

export async function removeWatchlistItem(symbol: string): Promise<void> {
  await http.delete(`/api/watchlist/${encodeURIComponent(symbol)}`);
}
