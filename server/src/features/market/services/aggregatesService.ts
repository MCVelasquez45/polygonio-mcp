import { getOptionAggregates } from '../../../shared/data/massive';
import { getRecentAggregateBars, StoredAggregateBar, upsertAggregateBars } from './aggregatesStore';
import { getMarketStatusSnapshot, MarketStatusSnapshot } from './marketStatus';

/**
 * Normalizes option aggregate bars, handling cache fallbacks + session awareness so
 * React charts can present consistent candles regardless of upstream hiccups.
 */

type SupportedTimespan = 'minute' | 'hour' | 'day';

const TIMESPAN_MS: Record<SupportedTimespan, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000
};

const MARKET_CLOSE_UTC_HOUR = 21; // 4:00 PM ET (approx, ignores DST but good enough for fallback displays)

type AggregatesParams = {
  ticker: string;
  multiplier: number;
  timespan: string;
  window: number;
  from?: string | null;
  to?: string | null;
};

type SessionAttempt = {
  label: 'regular' | 'after-hours' | 'previous-session' | 'fallback';
  fromDate: Date;
  toDate: Date;
  usingLastSession: boolean;
};

export type NormalizedAggregateBar = {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  vw: number | null;
  n: number | null;
};

type MarketStatusSummary = {
  state: 'open' | 'closed' | 'after-hours' | 'pre-market' | 'unknown';
  asOf: string;
  nextOpen?: string | null;
  nextClose?: string | null;
};

export type AggregatesResponse = {
  ticker: string;
  interval: string;
  marketClosed: boolean;
  afterHours: boolean;
  usingLastSession: boolean;
  resultGranularity: 'intraday' | 'daily' | 'cache';
  results: NormalizedAggregateBar[];
  fetchedAt: Date;
  cache: 'fresh' | 'hit';
  note?: string;
  marketStatus: MarketStatusSummary;
};

function assertTimespan(value: string): asserts value is SupportedTimespan {
  if (value !== 'minute' && value !== 'hour' && value !== 'day') {
    throw Object.assign(new Error(`Unsupported timespan "${value}". Use minute, hour, or day.`), { status: 400 });
  }
}

function formatInterval(multiplier: number, timespan: SupportedTimespan): string {
  const suffix = timespan === 'minute' ? 'm' : timespan === 'hour' ? 'h' : 'd';
  return `${multiplier}${suffix}`;
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function normalizeBars(bars: StoredAggregateBar[]): NormalizedAggregateBar[] {
  return bars
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp)
    .map(bar => ({
      t: new Date(bar.timestamp).toISOString(),
      o: bar.open,
      h: bar.high,
      l: bar.low,
      c: bar.close,
      v: bar.volume ?? 0,
      vw: typeof bar.vwap === 'number' ? bar.vwap : null,
      n: typeof bar.transactions === 'number' ? bar.transactions : null
    }));
}

function aggregateMinuteBars(bars: StoredAggregateBar[], targetMultiplier: number): StoredAggregateBar[] {
  if (targetMultiplier <= 1 || !bars.length) return bars;
  const bucketMs = targetMultiplier * TIMESPAN_MS.minute;
  const sorted = bars.slice().sort((a, b) => a.timestamp - b.timestamp);
  const buckets = new Map<number, StoredAggregateBar>();
  for (const bar of sorted) {
    const bucketStart = Math.floor(bar.timestamp / bucketMs) * bucketMs;
    const existing = buckets.get(bucketStart);
    if (!existing) {
      buckets.set(bucketStart, {
        timestamp: bucketStart,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        vwap: bar.vwap ?? null,
        transactions: bar.transactions ?? null
      });
    } else {
      existing.high = Math.max(existing.high, bar.high);
      existing.low = Math.min(existing.low, bar.low);
      existing.close = bar.close;
      existing.volume = (existing.volume ?? 0) + (bar.volume ?? 0);
      if (bar.vwap != null) existing.vwap = bar.vwap;
      if (bar.transactions != null) {
        existing.transactions = (existing.transactions ?? 0) + (bar.transactions ?? 0);
      }
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.timestamp - b.timestamp);
}

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function alignToMarketClose(date: Date): Date {
  const clone = new Date(date);
  clone.setUTCHours(MARKET_CLOSE_UTC_HOUR, 0, 0, 0);
  return clone;
}

function moveToPreviousBusinessDay(date: Date): Date {
  const clone = new Date(date);
  clone.setUTCHours(16, 0, 0, 0);
  do {
    clone.setUTCDate(clone.getUTCDate() - 1);
  } while (isWeekend(clone));
  return clone;
}

function deriveSessionClose(base: Date, status: MarketStatusSnapshot): Date {
  const reference = new Date(base);
  if (status.isHoliday || isWeekend(reference) || status.market === 'closed') {
    return alignToMarketClose(moveToPreviousBusinessDay(reference));
  }
  return alignToMarketClose(reference);
}

function buildMarketState(status: MarketStatusSnapshot): MarketStatusSummary {
  let state: MarketStatusSummary['state'] = 'unknown';
  if (status.market === 'open') state = 'open';
  else if (status.afterHours) state = 'after-hours';
  else if (status.preMarket) state = 'pre-market';
  else state = 'closed';
  return {
    state,
    asOf: status.serverTime.toISOString(),
    nextOpen: status.nextOpen ?? null,
    nextClose: status.nextClose ?? null
  };
}

// Determines which session windows to attempt (regular, after-hours, previous)
// based on current market state. Helps the fetcher gracefully degrade.
function buildSessionPlan(args: {
  status: MarketStatusSnapshot;
  durationMs: number;
  timespan: SupportedTimespan;
}): { attempts: SessionAttempt[]; marketClosed: boolean; afterHours: boolean } {
  const { status, durationMs } = args;
  const baseTime = status.serverTime;
  const attempts: SessionAttempt[] = [];
  const marketClosed = status.market !== 'open';
  const afterHours = Boolean(status.afterHours);

  const pushAttempt = (attempt: SessionAttempt) => {
    const last = attempts.at(-1);
    if (last && last.label === attempt.label && last.usingLastSession === attempt.usingLastSession) {
      return;
    }
    attempts.push(attempt);
  };

  if (!marketClosed) {
    pushAttempt({
      label: 'regular',
      fromDate: new Date(baseTime.getTime() - durationMs),
      toDate: baseTime,
      usingLastSession: false
    });
  } else if (afterHours) {
    pushAttempt({
      label: 'after-hours',
      fromDate: new Date(baseTime.getTime() - durationMs),
      toDate: baseTime,
      usingLastSession: false
    });
  }

  if (marketClosed || afterHours || status.isHoliday || status.isWeekend) {
    const sessionClose = deriveSessionClose(baseTime, status);
    pushAttempt({
      label: 'previous-session',
      fromDate: new Date(sessionClose.getTime() - durationMs),
      toDate: sessionClose,
      usingLastSession: true
    });
  }

  if (!attempts.length) {
    pushAttempt({
      label: 'fallback',
      fromDate: new Date(baseTime.getTime() - durationMs),
      toDate: baseTime,
      usingLastSession: marketClosed
    });
  }

  return { attempts, marketClosed, afterHours };
}

// Helper that fetches bars for the given attempt + writes them to Mongo.
async function fetchRemoteBars(args: {
  ticker: string;
  multiplier: number;
  timespan: SupportedTimespan;
  window: number;
  attempt: SessionAttempt;
}): Promise<StoredAggregateBar[]> {
  const { ticker, multiplier, timespan, window, attempt } = args;
  const from = formatDateOnly(attempt.fromDate);
  const to = formatDateOnly(attempt.toDate);
  const remote = await getOptionAggregates(ticker, multiplier, timespan, window, from, to);
  if (remote.results.length) {
    await upsertAggregateBars(ticker, multiplier, timespan, remote.results, { source: 'massive' });
  }
  return remote.results;
}

/**
 * Entry point used by the router. Applies caching, fallback, and session-aware
 * logic so callers always get a consistent candle set even when Massive is
 * throttled. Returns normalized bars plus metadata for downstream UI.
 */
export async function resolveAggregates(params: AggregatesParams): Promise<AggregatesResponse> {
  const ticker = params.ticker?.trim().toUpperCase();
  if (!ticker) {
    throw Object.assign(new Error('ticker is required'), { status: 400 });
  }
  const multiplier = Math.max(1, Number(params.multiplier) || 1);
  assertTimespan(params.timespan);
  const timespan: SupportedTimespan = params.timespan;
  const window = Math.max(1, Number(params.window) || 1);

  const status = await getMarketStatusSnapshot();

  const needsMinuteAggregation = timespan === 'minute' && multiplier > 1;
  const baseMultiplier = needsMinuteAggregation ? 1 : multiplier;
  const baseTimespan: SupportedTimespan = needsMinuteAggregation ? 'minute' : timespan;
  const baseWindow = needsMinuteAggregation ? window * multiplier : window;

  if (params.from || params.to) {
    const remote = await getOptionAggregates(
      ticker,
      needsMinuteAggregation ? 1 : multiplier,
      baseTimespan,
      needsMinuteAggregation ? window * multiplier : window,
      params.from ?? undefined,
      params.to ?? undefined
    );
    if (remote.results.length) {
      await upsertAggregateBars(ticker, needsMinuteAggregation ? 1 : multiplier, baseTimespan, remote.results, {
        source: 'massive'
      });
    }
    const finalBars = needsMinuteAggregation ? aggregateMinuteBars(remote.results, multiplier) : remote.results;
    const trimmed = finalBars.length > window ? finalBars.slice(finalBars.length - window) : finalBars;
    const normalized = normalizeBars(trimmed);
    if (!normalized.length) {
      throw Object.assign(new Error('Aggregates unavailable for requested range'), { status: 404 });
    }
    return {
      ticker,
      interval: formatInterval(multiplier, timespan),
      marketClosed: status.market !== 'open',
      afterHours: Boolean(status.afterHours),
      usingLastSession: false,
      resultGranularity: 'intraday',
      results: normalized,
      fetchedAt: new Date(),
      cache: 'fresh',
      marketStatus: buildMarketState(status)
    };
  }

  const durationMs = TIMESPAN_MS[baseTimespan] * baseMultiplier * baseWindow;
  const [cachedBars, sessionPlan] = await Promise.all([
    getRecentAggregateBars(ticker, baseMultiplier, baseTimespan, baseWindow),
    Promise.resolve(buildSessionPlan({ status, durationMs, timespan: baseTimespan }))
  ]);

  let selectedBars: StoredAggregateBar[] = [];
  let granularity: AggregatesResponse['resultGranularity'] = 'intraday';
  let usingLastSession = sessionPlan.marketClosed;
  let note: string | undefined;
  let cacheState: AggregatesResponse['cache'] = 'fresh';

  for (const attempt of sessionPlan.attempts) {
    try {
      const remoteBars = await fetchRemoteBars({
        ticker,
        multiplier: baseMultiplier,
        timespan: baseTimespan,
        window: baseWindow,
        attempt
      });
      if (remoteBars.length) {
        selectedBars = remoteBars;
        usingLastSession = attempt.usingLastSession;
        break;
      }
    } catch (error: any) {
      note = error?.message ?? 'Failed to load live aggregates';
    }
  }

  if (!selectedBars.length && timespan !== 'day') {
    try {
      const dailyFallback = await getOptionAggregates(ticker, 1, 'day', Math.max(window, 5));
      if (dailyFallback.results.length) {
        selectedBars = dailyFallback.results;
        granularity = 'daily';
        usingLastSession = true;
        note = note ?? 'No intraday data available; showing last daily session.';
      }
    } catch (error: any) {
      note = note ?? error?.message ?? 'Failed to load daily aggregates';
    }
  }

  if (!selectedBars.length && cachedBars.length) {
    selectedBars = cachedBars;
    granularity = 'cache';
    usingLastSession = true;
    cacheState = 'hit';
    note = note ?? 'Serving cached session due to upstream limits.';
  }

  if (!selectedBars.length) {
    throw Object.assign(new Error('Aggregates unavailable'), { status: 503 });
  }

  let finalBars = needsMinuteAggregation ? aggregateMinuteBars(selectedBars, multiplier) : selectedBars;
  if (finalBars.length > window) {
    finalBars = finalBars.slice(finalBars.length - window);
  }
  const normalized = normalizeBars(finalBars);

  return {
    ticker,
    interval: formatInterval(multiplier, timespan),
    marketClosed: sessionPlan.marketClosed,
    afterHours: sessionPlan.afterHours,
    usingLastSession,
    resultGranularity: granularity,
    results: normalized,
    fetchedAt: new Date(),
    cache: cacheState,
    note,
    marketStatus: buildMarketState(status)
  };
}
