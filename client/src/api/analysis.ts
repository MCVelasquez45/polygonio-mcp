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
