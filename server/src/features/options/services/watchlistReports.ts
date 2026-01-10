// Builds summary reports for watchlist tickers. Prefers AI-generated summaries
// (agent service) but falls back to deterministic Massive snapshots when the
// agent is offline.
import { getMassiveOptionsSnapshot, getMassiveShortInterest, getMassiveShortVolume } from '../../../shared/data/massive';
import { getRecentAggregateBars } from '../../market/services/aggregatesStore';
import { agentAnalyze, type AiRequestMeta } from '../../assistant/agentClient';

const AGENT_API_URL = process.env.AGENT_API_URL || process.env.FASTAPI_URL || process.env.PYTHON_URL || '';
const WATCHLIST_REPORTS_TTL_MS = Number(process.env.WATCHLIST_REPORTS_TTL_MS ?? 10 * 60 * 1000);
const watchlistReportsCache = new Map<
  string,
  { reports: WatchlistReport[]; source: 'agent' | 'snapshot' | 'empty'; cachedAt: number }
>();
const watchlistReportsInFlight = new Map<string, Promise<{ reports: WatchlistReport[]; source: 'agent' | 'snapshot' | 'empty' }>>();

export type WatchlistReport = {
  symbol: string;
  headline?: string;
  summary?: string;
  sentiment?: 'bullish' | 'bearish' | 'neutral' | string;
  flow?: string | null;
  contract?: string | null;
  expiry?: string | null;
  ivRank?: number | null;
};

type AgentResponse = {
  reports?: WatchlistReport[];
};

type WatchlistContext = {
  symbol: string;
  snapshot?: Record<string, any> | null;
  dailyBars?: { t: string; o: number; h: number; l: number; c: number; v: number }[];
  minuteBars?: { t: string; o: number; h: number; l: number; c: number; v: number }[];
  metrics?: Record<string, any>;
  events?: { name: string; date: string; impact?: string }[];
};

// Normalized bars keep timestamps/fields consistent for prompts + fallbacks.

type ShortInterestSnapshot = {
  settlementDate: string | null;
  shortInterest: number | null;
  avgDailyVolume: number | null;
  daysToCover: number | null;
  changePct: number | null;
};

type ShortVolumeSnapshot = {
  date: string | null;
  shortVolume: number | null;
  shortVolumeRatio: number | null;
  averageShortVolume: number | null;
  spike: boolean | null;
};

function normalizeBars(bars: { timestamp: number; open: number; high: number; low: number; close: number; volume: number }[]) {
  return bars
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp)
    .map(bar => ({
      t: new Date(bar.timestamp).toISOString(),
      o: bar.open,
      h: bar.high,
      l: bar.low,
      c: bar.close,
      v: bar.volume
    }));
}

function buildCacheKey(tickers: string[]): string {
  return tickers.map(ticker => ticker.toUpperCase()).sort().join(',');
}

function summarizeShortInterest(payload: { results: any[] } | null): ShortInterestSnapshot | null {
  const latest = payload?.results?.[0];
  if (!latest) return null;
  const previous = payload?.results?.[1];
  const latestValue = typeof latest.shortInterest === 'number' ? latest.shortInterest : null;
  const previousValue = typeof previous?.shortInterest === 'number' ? previous.shortInterest : null;
  const changePct =
    typeof latestValue === 'number' && typeof previousValue === 'number' && previousValue !== 0
      ? ((latestValue - previousValue) / previousValue) * 100
      : null;
  return {
    settlementDate: latest.settlementDate ?? null,
    shortInterest: latestValue,
    avgDailyVolume: typeof latest.avgDailyVolume === 'number' ? latest.avgDailyVolume : null,
    daysToCover: typeof latest.daysToCover === 'number' ? latest.daysToCover : null,
    changePct
  };
}

function summarizeShortVolume(payload: { results: any[] } | null): ShortVolumeSnapshot | null {
  const latest = payload?.results?.[0];
  if (!latest) return null;
  const recentValues = payload?.results
    ?.slice(1, 11)
    .map((entry: any) => entry.shortVolume)
    .filter((value: unknown): value is number => typeof value === 'number');
  const averageShortVolume =
    recentValues && recentValues.length
      ? recentValues.reduce((sum, value) => sum + value, 0) / recentValues.length
      : null;
  const latestShortVolume = typeof latest.shortVolume === 'number' ? latest.shortVolume : null;
  const spike =
    typeof latestShortVolume === 'number' && typeof averageShortVolume === 'number' && averageShortVolume > 0
      ? latestShortVolume >= averageShortVolume * 2
      : null;
  return {
    date: latest.date ?? null,
    shortVolume: latestShortVolume,
    shortVolumeRatio: typeof latest.shortVolumeRatio === 'number' ? latest.shortVolumeRatio : null,
    averageShortVolume,
    spike
  };
}

// Builds the structured JSON passed to the agent (if enabled).
// Builds structured JSON describing each ticker (snapshot, recent bars, metrics)
// so the agent has context to generate richer narratives.
async function buildWatchlistContext(tickers: string[]): Promise<WatchlistContext[]> {
  return Promise.all(
    tickers.map(async symbol => {
      const isOptionSymbol = symbol.startsWith('O:');
      const [snapshot, dailyBars, minuteBars, shortInterestPayload, shortVolumePayload] = await Promise.all([
        getMassiveOptionsSnapshot(symbol).catch(() => null),
        getRecentAggregateBars(symbol, 1, 'day', 10).catch(() => []),
        getRecentAggregateBars(symbol, 5, 'minute', 20).catch(() => []),
        isOptionSymbol
          ? Promise.resolve(null)
          : getMassiveShortInterest({ ticker: symbol, limit: 2, sort: 'settlement_date', order: 'desc' }).catch(() => null),
        isOptionSymbol
          ? Promise.resolve(null)
          : getMassiveShortVolume({ ticker: symbol, limit: 12, sort: 'date', order: 'desc' }).catch(() => null)
      ]);
      const shortInterest = summarizeShortInterest(shortInterestPayload);
      const shortVolume = summarizeShortVolume(shortVolumePayload);
      return {
        symbol,
        snapshot,
        dailyBars: normalizeBars(dailyBars),
        minuteBars: normalizeBars(minuteBars),
        metrics: {
          lastClose: dailyBars.at(-1)?.close ?? null,
          dayChange: snapshot?.changePercent ?? null,
          refContract: snapshot?.referenceContract ?? null,
          iv: snapshot?.iv ?? null,
          vol: snapshot?.volume ?? null,
          oi: snapshot?.openInterest ?? null,
          shortInterest,
          shortVolume
        },
        events: []
      };
    })
  );
}

// Invokes the agent to generate more opinionated reports if available; returns null on failure.
// Attempts to use the MCP/AI agent to generate human-friendly summaries. If
// parsing fails or the agent errors, returns null so we can fall back.
async function fetchAgentReports(
  tickers: string[],
  meta?: AiRequestMeta
): Promise<WatchlistReport[] | null> {
  if (!AGENT_API_URL) return null;
  if (!tickers.length) return [];
  const context = await buildWatchlistContext(tickers);
  const prompt = [
    'You are a market desk assistant. Generate concise option flow notes for the following tickers:',
    tickers.join(', '),
    '',
    'Here is structured JSON context for each ticker:',
    JSON.stringify(context, null, 2),
    '',
    'Return ONLY valid JSON of this shape:',
    '[{"symbol":"SPY","headline":"...", "summary":"...", "sentiment":"bullish","flow":"+4.2M","contract":"O:SPY...", "expiry":"2025-12-19","ivRank":45}]',
    'Keep summaries under 200 characters.',
    'If shortInterest or shortVolume metrics are elevated, mention it in the summary or headline.',
    'Flag shortInterest when changePct >= 20 or daysToCover >= 5.',
    'Flag shortVolume when spike is true or shortVolumeRatio >= 50.',
    'Use the options snapshot (reference contract, volume, open interest) to infer put/call bias when possible.'
  ].join('\n');
  try {
    const data = await agentAnalyze(prompt, { watchlistReports: context }, {
      ...meta,
      feature: meta?.feature ?? 'analysis.watchlist'
    });
    const output = data?.output ?? data?.result ?? '';
    if (typeof output !== 'string') {
      return null;
    }
    const parsed = JSON.parse(output) as AgentResponse | WatchlistReport[];
    if (Array.isArray(parsed)) {
      return parsed.filter(entry => entry?.symbol);
    }
    if (Array.isArray(parsed?.reports)) {
      return parsed.reports.filter(entry => entry?.symbol);
    }
    return null;
  } catch (error) {
    console.warn('[WATCHLIST REPORTS] agent fetch failed', error);
    return null;
  }
}

function formatNumber(value: number | null | undefined, options: Intl.NumberFormatOptions = {}) {
  if (value == null || Number.isNaN(value)) return null;
  return new Intl.NumberFormat('en-US', options).format(value);
}

// Fallback when the agent is offline: derive summary text directly from Massive snapshots.
// Deterministic fallback: derive brief summary from Massive snapshot alone so
// the UI never goes blank when the agent is unavailable.
async function buildSnapshotReports(tickers: string[]): Promise<WatchlistReport[]> {
  const reports = await Promise.all(
    tickers.map(async symbol => {
      try {
        const snapshot = await getMassiveOptionsSnapshot(symbol);
        const priceLabel =
          typeof snapshot?.price === 'number'
            ? `$${snapshot.price.toFixed(2)}`
            : 'Price unavailable';
        const changePercent =
          typeof snapshot?.changePercent === 'number' ? snapshot.changePercent : null;
        const sentiment =
          typeof changePercent === 'number'
            ? changePercent > 0
              ? 'bullish'
              : changePercent < 0
              ? 'bearish'
              : 'neutral'
            : 'neutral';
        const changeLabel =
          changePercent != null ? `${changePercent.toFixed(2)}%` : '—';
        return {
          symbol: snapshot?.ticker ?? symbol,
          headline: `${snapshot?.name ?? symbol} · ${priceLabel}`,
          summary: `Spot move ${changeLabel}. Ref contract ${
            snapshot?.referenceContract ?? 'n/a'
          }.`,
          sentiment,
          flow:
            snapshot?.volume != null
              ? `${formatNumber(snapshot.volume, { maximumFractionDigits: 0 })} vol`
              : null,
          contract: snapshot?.referenceContract ?? null,
          expiry: null,
          ivRank: null
        } satisfies WatchlistReport;
      } catch (error) {
        return {
          symbol,
          headline: `${symbol} snapshot unavailable`,
          summary: 'No recent data.',
          sentiment: 'neutral',
          flow: null,
          contract: null,
          expiry: null,
          ivRank: null
        };
      }
    })
  );
  return reports;
}

/**
 * Public entry used by `/api/analysis/watchlist`. Returns agent-driven reports
 * when available, otherwise snapshot-based summaries.
 */
export async function getWatchlistReports(
  tickers: string[],
  meta?: AiRequestMeta
): Promise<{ reports: WatchlistReport[]; source: 'agent' | 'snapshot' | 'empty' }> {
  const unique = Array.from(new Set(tickers.map(ticker => ticker.toUpperCase()))).filter(Boolean);
  if (!unique.length) {
    return { reports: [], source: 'empty' };
  }
  const cacheKey = buildCacheKey(unique);
  const now = Date.now();
  if (WATCHLIST_REPORTS_TTL_MS > 0) {
    const cached = watchlistReportsCache.get(cacheKey);
    if (cached && now - cached.cachedAt < WATCHLIST_REPORTS_TTL_MS) {
      return { reports: cached.reports, source: cached.source };
    }
  }

  const inFlight = watchlistReportsInFlight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const task = (async () => {
    const agentReports = await fetchAgentReports(unique, meta);
    if (agentReports && agentReports.length) {
      return { reports: agentReports, source: 'agent' as const };
    }
    const fallbackReports = await buildSnapshotReports(unique);
    return { reports: fallbackReports, source: 'snapshot' as const };
  })();

  watchlistReportsInFlight.set(cacheKey, task);
  try {
    const result = await task;
    if (WATCHLIST_REPORTS_TTL_MS > 0) {
      watchlistReportsCache.set(cacheKey, { ...result, cachedAt: Date.now() });
    }
    return result;
  } finally {
    watchlistReportsInFlight.delete(cacheKey);
  }
}
