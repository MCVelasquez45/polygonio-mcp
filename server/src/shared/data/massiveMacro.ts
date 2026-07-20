import { massiveGet, REQUEST_PRIORITY } from './massive';

// Macro/news data for the AI orchestration layer. Endpoints verified against
// massive.com/docs (rest/stocks/news, rest/economy/*, rest/indices/snapshots).
// TTLs follow the AI Desk caching policy: news 5m, Fed/economy 15m, indices 60s.

const NEWS_TTL_MS = 5 * 60_000;
const ECONOMY_TTL_MS = 15 * 60_000;
const INDICES_TTL_MS = 60_000;

export type NewsArticle = {
  id: string;
  title: string;
  description: string | null;
  publisher: string | null;
  publishedUtc: string | null;
  articleUrl: string | null;
  tickers: string[];
  sentiment: { ticker: string; sentiment: string; reasoning: string | null }[];
};

export async function getTickerNews(ticker: string, limit = 10): Promise<NewsArticle[]> {
  const data = await massiveGet<any>(
    '/v2/reference/news',
    { ticker, limit, order: 'desc', sort: 'published_utc' },
    { cacheTtlMs: NEWS_TTL_MS, priority: REQUEST_PRIORITY.VISIBLE_UI }
  );
  const results = Array.isArray(data?.results) ? data.results : [];
  return results.map((item: any) => ({
    id: String(item?.id ?? ''),
    title: String(item?.title ?? ''),
    description: item?.description ?? null,
    publisher: item?.publisher?.name ?? null,
    publishedUtc: item?.published_utc ?? null,
    articleUrl: item?.article_url ?? null,
    tickers: Array.isArray(item?.tickers) ? item.tickers : [],
    sentiment: Array.isArray(item?.insights)
      ? item.insights.map((insight: any) => ({
          ticker: String(insight?.ticker ?? ''),
          sentiment: String(insight?.sentiment ?? 'unknown'),
          reasoning: insight?.sentiment_reasoning ?? null,
        }))
      : [],
  }));
}

export type TreasuryYieldObservation = {
  date: string;
  yield1Month: number | null;
  yield3Month: number | null;
  yield2Year: number | null;
  yield10Year: number | null;
  yield30Year: number | null;
};

export async function getTreasuryYields(limit = 10): Promise<TreasuryYieldObservation[]> {
  const data = await massiveGet<any>(
    '/fed/v1/treasury-yields',
    { limit },
    { cacheTtlMs: ECONOMY_TTL_MS, priority: REQUEST_PRIORITY.VISIBLE_UI }
  );
  const results = Array.isArray(data?.results) ? data.results : [];
  return results
    .map((row: any) => ({
      date: String(row?.date ?? ''),
      yield1Month: toNumber(row?.yield_1_month),
      yield3Month: toNumber(row?.yield_3_month),
      yield2Year: toNumber(row?.yield_2_year),
      yield10Year: toNumber(row?.yield_10_year),
      yield30Year: toNumber(row?.yield_30_year),
    }))
    .sort((a: TreasuryYieldObservation, b: TreasuryYieldObservation) => b.date.localeCompare(a.date));
}

export type EconomySeries = { date: string; values: Record<string, number | null> }[];

export async function getInflation(limit = 6): Promise<EconomySeries> {
  return economySeries('/fed/v1/inflation', limit);
}

export async function getLaborMarket(limit = 6): Promise<EconomySeries> {
  return economySeries('/fed/v1/labor-market', limit);
}

async function economySeries(path: string, limit: number): Promise<EconomySeries> {
  const data = await massiveGet<any>(
    path,
    { limit },
    { cacheTtlMs: ECONOMY_TTL_MS, priority: REQUEST_PRIORITY.VISIBLE_UI }
  );
  const results = Array.isArray(data?.results) ? data.results : [];
  return results
    .map((row: any) => {
      const { date, ...rest } = row ?? {};
      const values: Record<string, number | null> = {};
      for (const [key, value] of Object.entries(rest)) {
        const numeric = toNumber(value);
        if (numeric !== null) values[key] = numeric;
      }
      return { date: String(date ?? ''), values };
    })
    .sort((a: { date: string }, b: { date: string }) => b.date.localeCompare(a.date));
}

export type IndexSnapshot = {
  ticker: string;
  name: string | null;
  value: number | null;
  changePercent: number | null;
  marketStatus: string | null;
};

export async function getIndicesSnapshot(tickers: string[]): Promise<IndexSnapshot[]> {
  const data = await massiveGet<any>(
    '/v3/snapshot/indices',
    { 'ticker.any_of': tickers.join(',') },
    { cacheTtlMs: INDICES_TTL_MS, priority: REQUEST_PRIORITY.VISIBLE_UI }
  );
  const results = Array.isArray(data?.results) ? data.results : [];
  return results
    .filter((row: any) => !row?.error)
    .map((row: any) => ({
      ticker: String(row?.ticker ?? ''),
      name: row?.name ?? null,
      value: toNumber(row?.value),
      changePercent: toNumber(row?.session?.change_percent),
      marketStatus: row?.market_status ?? null,
    }));
}

function toNumber(value: unknown): number | null {
  const numeric = typeof value === 'string' ? Number(value) : value;
  return typeof numeric === 'number' && Number.isFinite(numeric) ? numeric : null;
}
