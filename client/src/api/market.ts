import { http } from './http';
import type { AggregateBar, OptionChainData, OptionContractDetail, QuoteSnapshot, TradePrint, WatchlistSnapshot } from '../types/market';

type MarketMeta = {
  fetchedAt?: string;
  cache?: 'hit' | 'miss' | 'fresh';
};

type AggregatesResponse = MarketMeta & {
  ticker: string;
  interval: string;
  marketClosed: boolean;
  afterHours: boolean;
  usingLastSession: boolean;
  resultGranularity: 'intraday' | 'daily' | 'cache';
  marketStatus?: {
    state: 'open' | 'closed' | 'after-hours' | 'pre-market' | 'unknown';
    asOf: string;
    nextOpen?: string | null;
    nextClose?: string | null;
  };
  results: {
    t: string | number;
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
    vw: number | null;
    n: number | null;
  }[];
  note?: string;
};

type TradesResponse = MarketMeta & {
  ticker: string;
  trades: TradePrint[];
};

export type ShortInterestEntry = {
  ticker: string;
  settlementDate: string | null;
  shortInterest: number | null;
  avgDailyVolume: number | null;
  daysToCover: number | null;
};

export type ShortInterestResponse = MarketMeta & {
  ticker: string;
  requestedTicker?: string;
  resolvedTicker?: string;
  results: ShortInterestEntry[];
};

export type ShortVolumeEntry = {
  ticker: string;
  date: string | null;
  shortVolume: number | null;
  shortVolumeRatio: number | null;
  totalVolume: number | null;
  nonExemptVolume: number | null;
  exemptVolume: number | null;
};

export type ShortVolumeResponse = MarketMeta & {
  ticker: string;
  requestedTicker?: string;
  resolvedTicker?: string;
  results: ShortVolumeEntry[];
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

export async function warmAggregates(tickers: string[]): Promise<{ tickers: string[] }> {
  const { data } = await http.post<{ tickers: string[] }>('/api/market/aggs/warm', { tickers });
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

export async function getOptionContractDetail(symbol: string): Promise<OptionContractDetail & MarketMeta> {
  const { data } = await http.get<OptionContractDetail & MarketMeta>(`/api/market/options/contracts/${symbol}`);
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

export async function getShortInterest(params: {
  ticker: string;
  from?: string;
  to?: string;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}): Promise<ShortInterestResponse> {
  const { data } = await http.get<ShortInterestResponse>('/api/market/short-interest', { params });
  return data;
}

export async function getShortVolume(params: {
  ticker: string;
  from?: string;
  to?: string;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}): Promise<ShortVolumeResponse> {
  const { data } = await http.get<ShortVolumeResponse>('/api/market/short-volume', { params });
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
