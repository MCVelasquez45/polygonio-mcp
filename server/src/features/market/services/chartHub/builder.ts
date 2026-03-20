import type { Candle } from './buffer';
import type { TimeframeConfig } from './backfill';

const AGG_TIMESTAMP_MS_THRESHOLD = 1_000_000_000_000;

type MinuteBar = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type BuilderState = {
  lastSeen: number;
  minuteBars: Map<number, MinuteBar>;
};

const stateByKey = new Map<string, BuilderState>();

export type AggregateBuildResult = {
  candle: Candle;
  minuteStart: number;
  bucketStart: number;
};

export function ingestAggregateEvent(args: {
  key: string;
  symbol: string;
  timeframe: TimeframeConfig;
  event: any;
  maxMinuteBars: number;
}): AggregateBuildResult | null {
  if (args.timeframe.timespan !== 'minute') return null;
  const normalized = normalizeAggregateEvent(args.event);
  if (!normalized) return null;
  if (normalized.symbol !== args.symbol) return null;

  const minuteStart = Math.floor(normalized.start / 60_000) * 60_000;
  const state = getState(args.key);
  if (normalized.start < state.lastSeen) return null;
  state.lastSeen = normalized.start;

  upsertMinuteBar(state, normalized, minuteStart);
  pruneMinuteBars(state, args.maxMinuteBars);

  const bucketMs = args.timeframe.multiplier * 60_000;
  const bucketStart = Math.floor(minuteStart / bucketMs) * bucketMs;
  const bucketEnd = bucketStart + bucketMs;
  const bucketBars = Array.from(state.minuteBars.entries())
    .filter(([timestamp]) => timestamp >= bucketStart && timestamp < bucketEnd)
    .sort((a, b) => a[0] - b[0])
    .map(([, bar]) => bar);
  if (!bucketBars.length) return null;

  const aggregated = buildAggregateBar(bucketBars, bucketStart);
  const isFinal = normalized.eventType === 'AM' && minuteStart + 60_000 >= bucketEnd;

  return {
    candle: {
      t: bucketStart,
      o: aggregated.open,
      h: aggregated.high,
      l: aggregated.low,
      c: aggregated.close,
      v: aggregated.volume,
      isFinal,
      source: 'live'
    },
    minuteStart,
    bucketStart
  };
}

function getState(key: string): BuilderState {
  const existing = stateByKey.get(key);
  if (existing) return existing;
  const created: BuilderState = {
    lastSeen: 0,
    minuteBars: new Map()
  };
  stateByKey.set(key, created);
  return created;
}

function upsertMinuteBar(state: BuilderState, event: NormalizedAggregateEvent, minuteStart: number) {
  const existing = state.minuteBars.get(minuteStart);
  if (!existing || event.eventType === 'AM') {
    state.minuteBars.set(minuteStart, {
      timestamp: minuteStart,
      open: event.open,
      high: event.high,
      low: event.low,
      close: event.close,
      volume: event.volume
    });
    return;
  }

  state.minuteBars.set(minuteStart, {
    timestamp: minuteStart,
    open: existing.open,
    high: Math.max(existing.high, event.high),
    low: Math.min(existing.low, event.low),
    close: event.close,
    volume: existing.volume + event.volume
  });
}

function pruneMinuteBars(state: BuilderState, maxBars: number) {
  if (maxBars <= 0 || state.minuteBars.size <= maxBars) return;
  const keys = Array.from(state.minuteBars.keys()).sort((a, b) => a - b);
  const overflow = keys.length - maxBars;
  if (overflow <= 0) return;
  keys.slice(0, overflow).forEach(key => state.minuteBars.delete(key));
}

function buildAggregateBar(bars: MinuteBar[], bucketStart: number): MinuteBar {
  return {
    timestamp: bucketStart,
    open: bars[0].open,
    high: Math.max(...bars.map(bar => bar.high)),
    low: Math.min(...bars.map(bar => bar.low)),
    close: bars[bars.length - 1].close,
    volume: bars.reduce((sum, bar) => sum + bar.volume, 0)
  };
}

type NormalizedAggregateEvent = {
  symbol: string;
  start: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  eventType: string;
};

function normalizeAggregateEvent(event: any): NormalizedAggregateEvent | null {
  if (!event) return null;
  const symbol = normalizeSymbol(event.symbol ?? event.sym ?? event.ticker);
  if (!symbol) return null;
  const open = coerceNumber(event.o ?? event.open);
  const high = coerceNumber(event.h ?? event.high);
  const low = coerceNumber(event.l ?? event.low);
  const close = coerceNumber(event.c ?? event.close);
  if (open == null || high == null || low == null || close == null) return null;
  const volume = coerceNumber(event.v ?? event.volume) ?? 0;
  const start = coerceTimestamp(event.s ?? event.start ?? event.t ?? event.timestamp ?? event.receivedAt);
  return {
    symbol,
    start,
    open,
    high,
    low,
    close,
    volume,
    eventType: String(event.ev ?? event.event ?? '').toUpperCase()
  };
}

function normalizeSymbol(value: any): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return normalized.length ? normalized : null;
}

function coerceNumber(value: any): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function coerceTimestamp(value: any): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > AGG_TIMESTAMP_MS_THRESHOLD ? value : value * 1000;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric > AGG_TIMESTAMP_MS_THRESHOLD ? numeric : numeric * 1000;
    }
  }
  return Date.now();
}
