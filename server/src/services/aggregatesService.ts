import { getOptionAggregates } from './massive';
import { getRecentAggregateBars, StoredAggregateBar, upsertAggregateBars } from './aggregatesStore';

const TIMESPAN_MS: Record<string, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000
};

type AggregatesParams = {
  ticker: string;
  multiplier: number;
  timespan: 'minute' | 'hour' | 'day';
  window: number;
  from?: string | null;
  to?: string | null;
};

export type AggregatesResponse = {
  ticker: string;
  results: StoredAggregateBar[];
  fetchedAt: Date;
  fromCache: boolean;
};

function computeFreshnessThreshold(multiplier: number, timespan: string): number {
  const unit = TIMESPAN_MS[timespan] ?? TIMESPAN_MS.day;
  return unit * multiplier;
}

export async function resolveAggregates(params: AggregatesParams): Promise<AggregatesResponse> {
  const ticker = params.ticker.toUpperCase();
  const multiplier = Math.max(1, params.multiplier);
  const timespan: 'minute' | 'hour' | 'day' = params.timespan || 'day';
  const window = Math.max(1, params.window);
  const hasExplicitRange = Boolean(params.from || params.to);

  if (hasExplicitRange) {
    const remote = await getOptionAggregates(ticker, multiplier, timespan, window, params.from ?? undefined, params.to ?? undefined);
    if (remote.results.length) {
      await upsertAggregateBars(ticker, multiplier, timespan, remote.results, { source: 'massive' });
    }
    return {
      ticker,
      results: remote.results,
      fetchedAt: new Date(),
      fromCache: false
    };
  }

  const existing = await getRecentAggregateBars(ticker, multiplier, timespan, window);
  const latestTimestamp = existing.at(-1)?.timestamp ?? 0;
  const freshnessThreshold = computeFreshnessThreshold(multiplier, timespan);
  const isFresh = existing.length >= window && Date.now() - latestTimestamp <= freshnessThreshold;

  if (isFresh) {
    return {
      ticker,
      results: existing,
      fetchedAt: new Date(latestTimestamp || Date.now()),
      fromCache: true
    };
  }

  try {
    const remote = await getOptionAggregates(ticker, multiplier, timespan, window);
    if (remote.results.length) {
      await upsertAggregateBars(ticker, multiplier, timespan, remote.results, { source: 'massive' });
    }
  } catch (error) {
    console.warn('[AGGREGATES] failed to refresh remote data, falling back to cached bars', {
      ticker,
      multiplier,
      timespan,
      window,
      error: error instanceof Error ? error.message : String(error)
    });
    if (existing.length) {
      return {
        ticker,
        results: existing,
        fetchedAt: new Date(latestTimestamp || Date.now()),
        fromCache: true
      };
    }
    throw error;
  }

  const refreshed = await getRecentAggregateBars(ticker, multiplier, timespan, window);
  const timestamp = refreshed.at(-1)?.timestamp ?? Date.now();

  return {
    ticker,
    results: refreshed,
    fetchedAt: new Date(timestamp),
    fromCache: false
  };
}
