import { resolveAggregates } from '../aggregatesService';
import type { Candle, CandleSource } from './buffer';
import type { HealthMeta, HealthMode, HealthSource } from './health';

const TIMEFRAME_MAP = {
  '1/minute': { multiplier: 1, timespan: 'minute' as const, window: 3900 }, // ~10 days
  '3/minute': { multiplier: 3, timespan: 'minute' as const, window: 1300 },
  '5/minute': { multiplier: 5, timespan: 'minute' as const, window: 780 },  // ~10 days
  '15/minute': { multiplier: 15, timespan: 'minute' as const, window: 260 },
  '30/minute': { multiplier: 30, timespan: 'minute' as const, window: 130 },
  '1/hour': { multiplier: 1, timespan: 'hour' as const, window: 200 },    // ~1 month
  '1/day': { multiplier: 1, timespan: 'day' as const, window: 252 }        // ~1 year
};

const OPENING_RANGE_START_MINUTES = 9 * 60 + 30;
const REGULAR_SESSION_END_MINUTES = 16 * 60;
const NY_TIMEZONE = 'America/New_York';
const AGG_TIMESTAMP_MS_THRESHOLD = 1_000_000_000_000;

const NY_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: NY_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
});

export type TimeframeConfig = {
  key: string;
  multiplier: number;
  timespan: 'minute' | 'hour' | 'day';
  window: number;
};

export type SessionMetaBase = {
  marketClosed: boolean;
  afterHours: boolean;
  usingLastSession: boolean;
  resultGranularity: 'intraday' | 'daily' | 'cache';
  note?: string | null;
  state?: string;
  nextOpen?: string | null;
  nextClose?: string | null;
  fetchedAt?: string;
};

export type BackfillResult = {
  candles: Candle[];
  healthMeta: HealthMeta;
  sessionMeta: SessionMetaBase;
};

const inflight = new Map<string, Promise<BackfillResult>>();

export function resolveTimeframe(timeframe: string): TimeframeConfig {
  const fallbackKey = '5/minute';
  const config = TIMEFRAME_MAP[timeframe as keyof typeof TIMEFRAME_MAP] ?? TIMEFRAME_MAP[fallbackKey];
  const key = timeframe in TIMEFRAME_MAP ? timeframe : fallbackKey;
  return { key, ...config };
}

export function resolveTimeframeMs(config: TimeframeConfig): number {
  const base = config.timespan === 'minute' ? 60_000 : config.timespan === 'hour' ? 3_600_000 : 86_400_000;
  return base * config.multiplier;
}

export async function backfillBars(args: {
  symbol: string;
  timeframe: TimeframeConfig;
  sessionMode: 'regular' | 'extended';
}): Promise<BackfillResult> {
  const key = `${args.symbol}:${args.timeframe.key}`;
  const existing = inflight.get(key);
  if (existing) return await existing;
  const run = (async () => {
    const window = resolveChartWindow(args.timeframe, args.sessionMode === 'regular');
    const aggregates = await resolveAggregates({
      ticker: args.symbol,
      multiplier: args.timeframe.multiplier,
      timespan: args.timeframe.timespan,
      window
    });

    const candles = normalizeAggregateResults(aggregates.results ?? [], {
      source: resolveCandleSource(aggregates.health?.source),
      isFinal: true
    });

    const healthMeta: HealthMeta = {
      mode: resolveHealthMode(aggregates.health?.mode, aggregates.marketClosed),
      source: resolveHealthSource(aggregates.health?.source),
      providerThrottled: aggregates.health?.providerThrottled ?? false,
      gapsDetected: aggregates.health?.gapsDetected ?? 0
    };

    const sessionMeta: SessionMetaBase = {
      marketClosed: Boolean(aggregates.marketClosed),
      afterHours: Boolean(aggregates.afterHours),
      usingLastSession: Boolean(aggregates.usingLastSession),
      resultGranularity: aggregates.resultGranularity ?? 'intraday',
      note: aggregates.note ?? null,
      state: aggregates.marketStatus?.state,
      nextOpen: aggregates.marketStatus?.nextOpen ?? null,
      nextClose: aggregates.marketStatus?.nextClose ?? null,
      fetchedAt: aggregates.marketStatus?.asOf ?? aggregates.fetchedAt?.toISOString?.() ?? undefined
    };

    return { candles, healthMeta, sessionMeta };
  })();
  inflight.set(key, run);
  try {
    return await run;
  } finally {
    inflight.delete(key);
  }
}

export function filterBarsForSessionMode(
  bars: Candle[],
  sessionMode: 'regular' | 'extended',
  timeframe: TimeframeConfig
): Candle[] {
  if (sessionMode !== 'regular') return bars;
  if (timeframe.timespan === 'day') return bars;
  return bars.filter(bar => isRegularSessionTimestamp(bar.t));
}

export function isRegularSessionTimestamp(timestamp: number): boolean {
  const parts = getNyParts(timestamp);
  if (!parts) return false;
  const minuteOfDay = parts.hour * 60 + parts.minute;
  return minuteOfDay >= OPENING_RANGE_START_MINUTES && minuteOfDay < REGULAR_SESSION_END_MINUTES;
}

export function buildSessionNote(sessionMode: 'regular' | 'extended', timeframe: TimeframeConfig): string | null {
  if (sessionMode !== 'regular') return null;
  if (timeframe.timespan === 'day') return null;
  return 'Regular trading hours only (9:30-16:00 ET).';
}

function resolveChartWindow(config: TimeframeConfig, useRegularHours: boolean): number {
  const baseWindow = config.window ?? 180;
  if (!useRegularHours || config.timespan === 'day') return baseWindow;
  const minutesPerBar = config.multiplier * (config.timespan === 'hour' ? 60 : 1);
  const extendedMinutes = 16 * 60;
  const requiredBars = Math.ceil(extendedMinutes / minutesPerBar);
  return Math.max(baseWindow, requiredBars);
}

function normalizeAggregateResults(
  results: Array<{ t: string | number; o: number; h: number; l: number; c: number; v: number }>,
  defaults: { source: CandleSource; isFinal: boolean }
): Candle[] {
  return (results ?? [])
    .map(entry => {
      const timestamp = parseAggregateTimestamp(entry.t);
      if (timestamp == null) return null;
      return {
        t: timestamp,
        o: entry.o,
        h: entry.h,
        l: entry.l,
        c: entry.c,
        v: entry.v,
        isFinal: defaults.isFinal,
        source: defaults.source
      };
    })
    .filter((bar): bar is Candle => Boolean(bar))
    .sort((a, b) => a.t - b.t);
}

function parseAggregateTimestamp(value: string | number): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < AGG_TIMESTAMP_MS_THRESHOLD ? value * 1000 : value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric < AGG_TIMESTAMP_MS_THRESHOLD ? numeric * 1000 : numeric;
    }
  }
  return null;
}

function resolveCandleSource(source?: string | null): CandleSource {
  if (source === 'cache') return 'cache';
  if (source === 'snapshot') return 'snapshot';
  return 'backfill';
}

function resolveHealthSource(source?: string | null): HealthSource {
  if (source === 'cache') return 'cache';
  if (source === 'snapshot') return 'snapshot';
  return 'rest';
}

function resolveHealthMode(mode: string | undefined, marketClosed: boolean): HealthMode {
  if (marketClosed) return 'FROZEN';
  if (mode === 'LIVE' || mode === 'BACKFILLING' || mode === 'DEGRADED') return mode;
  return 'DEGRADED';
}

function getNyParts(timestamp: number) {
  const parts = NY_FORMATTER.formatToParts(new Date(timestamp));
  const bucket: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      bucket[part.type] = part.value;
    }
  }
  const year = bucket.year ?? '';
  const month = bucket.month ?? '';
  const day = bucket.day ?? '';
  const hour = Number(bucket.hour);
  const minute = Number(bucket.minute);
  if (!year || !month || !day || Number.isNaN(hour) || Number.isNaN(minute)) {
    return null;
  }
  return {
    dateKey: `${year}-${month}-${day}`,
    hour,
    minute
  };
}
