import { http } from './http';
import type {
  AggregateBar,
  OptionChainData,
  OptionContractDetail,
  QuoteSnapshot,
  TradePrint,
  WatchlistSnapshot,
} from '../types/market';

type MarketMeta = {
  fetchedAt?: string;
  cache?: 'hit' | 'miss';
};

type AggregatesResponse = MarketMeta & {
  ticker: string;
  results: AggregateBar[];
};

type TradesResponse = MarketMeta & {
  ticker: string;
  trades: TradePrint[];
};

type WatchlistResponse = {
  entries: (WatchlistSnapshot & MarketMeta)[];
};

export async function getAggregates(params: {
  ticker: string;
  multiplier?: number;
  timespan?: 'minute' | 'hour' | 'day';
  window?: number;
  from?: string;
  to?: string;
}): Promise<AggregatesResponse> {
  const { data } = await http.get<AggregatesResponse>('/api/market/aggs', { params });
  return data;
}

export async function getTrades(ticker: string): Promise<TradesResponse> {
  const { data } = await http.get<TradesResponse>(`/api/market/trades/${ticker}`);
  return data;
}

export async function getQuote(ticker: string): Promise<QuoteSnapshot & MarketMeta> {
  const { data } = await http.get<QuoteSnapshot & MarketMeta>(`/api/market/quotes/${ticker}`);
  return data;
}

export async function getOptionsChain(params: { ticker: string; limit?: number; expiration?: string | null }): Promise<OptionChainData & MarketMeta> {
  const { data } = await http.get<OptionChainData & MarketMeta>(`/api/market/options/chain/${params.ticker}`, {
    params: { limit: params.limit, expiration: params.expiration ?? undefined },
  });
  return data;
}

export async function getOptionContract(optionSymbol: string): Promise<OptionContractDetail & MarketMeta> {
  const { data } = await http.get<OptionContractDetail & MarketMeta>(`/api/market/options/contracts/${optionSymbol}`);
  return data;
}

type ExpirationsResponse = {
  ticker: string;
  expirations: string[];
};

export async function getOptionExpirations(ticker: string): Promise<ExpirationsResponse> {
  const { data } = await http.get<ExpirationsResponse>(`/api/market/options/expirations/${ticker}`);
  return data;
}

export type PersistedSelection = {
  ticker: string;
  contract: string;
  expiration?: string;
  strike?: number;
  type?: 'call' | 'put';
  side?: 'buy' | 'sell';
};

export async function getPersistedSelection(userId = 'default'): Promise<{ selection: (PersistedSelection & { updatedAt?: string }) | null }> {
  const { data } = await http.get(`/api/market/options/selection`, { params: { userId } });
  return data;
}

export async function savePersistedSelection(selection: PersistedSelection, userId = 'default'): Promise<void> {
  await http.post('/api/market/options/selection', { ...selection, userId });
}

export async function getWatchlistSnapshots(tickers: string[]): Promise<WatchlistResponse> {
  if (!tickers.length) {
    return { entries: [] };
  }
  const params = { tickers: tickers.join(',') };
  const { data } = await http.get<WatchlistResponse>('/api/market/watchlist', { params });
  return data;
}
