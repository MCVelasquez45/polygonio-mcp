import { http } from './http';

export type WatchlistReport = {
  symbol: string;
  headline?: string;
  summary?: string;
  sentiment?: string;
  flow?: string | null;
  contract?: string | null;
  expiry?: string | null;
  ivRank?: number | null;
};

type WatchlistReportsResponse = {
  reports: WatchlistReport[];
  source?: string;
  fetchedAt?: string;
};

export async function getWatchlistReports(tickers: string[]): Promise<WatchlistReportsResponse> {
  const { data } = await http.post<WatchlistReportsResponse>('/api/analysis/watchlist', { tickers });
  return data;
}

export type ChecklistFactor = {
  key: string;
  label: string;
  detail: string;
  passed: boolean;
};

export type ChecklistResult = {
  symbol: string;
  referenceContract?: string | null;
  price: number | null;
  emaShort: number | null;
  emaLong: number | null;
  support: number | null;
  resistance: number | null;
  optionMetrics: {
    delta: number | null;
    iv: number | null;
    volume: number | null;
    openInterest: number | null;
    spread: number | null;
  };
  sentiment?: { label?: string | null; score?: number | null } | null;
  fedEvent?: { name?: string; title?: string; date?: string; impact?: string } | null;
  factors: ChecklistFactor[];
  qualifies: boolean;
  updatedAt: string;
};

type ChecklistResponse = {
  results: ChecklistResult[];
  fetchedAt?: string;
};

export async function runChecklist(tickers: string[], force = false): Promise<ChecklistResponse> {
  const { data } = await http.post<ChecklistResponse>('/api/analysis/checklist', { tickers, force });
  return data;
}
