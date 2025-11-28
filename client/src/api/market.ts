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

export async function getOptionsChain(params: { ticker: string; limit?: number }): Promise<OptionChainData & MarketMeta> {
  const { data } = await http.get<OptionChainData & MarketMeta>(`/api/market/options/chain/${params.ticker}`, {
    params: { limit: params.limit },
  });
  return data;
}

export async function getOptionContract(optionSymbol: string): Promise<OptionContractDetail & MarketMeta> {
  const { data } = await http.get<OptionContractDetail & MarketMeta>(`/api/market/options/contracts/${optionSymbol}`);
  return data;
}

export async function getWatchlistSnapshots(tickers: string[]): Promise<WatchlistResponse> {
  if (!tickers.length) {
    return { entries: [] };
  }
  const params = { tickers: tickers.join(',') };
  const { data } = await http.get<WatchlistResponse>('/api/market/watchlist', { params });
  return data;
}

