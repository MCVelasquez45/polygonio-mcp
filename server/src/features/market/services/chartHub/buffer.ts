import { buildHealth, type DataQualityMetrics, type HealthMeta, type HealthMode, type HealthSource, type HealthState } from './health';

export type CandleSource = 'live' | 'backfill' | 'cache' | 'snapshot';

export type Candle = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  isFinal: boolean;
  source: CandleSource;
};

export type BufferSnapshot = {
  bars: Candle[];
  health: HealthState | null;
};

export type BufferStats = {
  symbol: string;
  timeframe: string;
  barCount: number;
  oldestTimestamp: number | null;
  newestTimestamp: number | null;
  partialCount: number;
  healthMeta: HealthMeta | null;
};

type BufferState = {
  symbol: string;
  timeframe: string;
  bars: Candle[];
  healthMeta: HealthMeta | null;
  lastMergeTime: number;
  anomalyCount: number;
};

const buffers = new Map<string, BufferState>();

// Merge lock to prevent concurrent modifications
const mergeLocks = new Map<string, Promise<void>>();

export function getOrCreateBuffer(key: string, symbol: string, timeframe: string): BufferState {
  const existing = buffers.get(key);
  if (existing) return existing;
  const created: BufferState = {
    symbol,
    timeframe,
    bars: [],
    healthMeta: null,
    lastMergeTime: 0,
    anomalyCount: 0
  };
  buffers.set(key, created);
  return created;
}

export function getHealthMeta(key: string): HealthMeta | null {
  return buffers.get(key)?.healthMeta ?? null;
}

export function setHealthMeta(key: string, meta: HealthMeta) {
  const buffer = buffers.get(key);
  if (!buffer) return;
  buffer.healthMeta = meta;
}

export function incrementAnomalyCount(key: string) {
  const buffer = buffers.get(key);
  if (buffer) buffer.anomalyCount += 1;
}

export function replaceBars(key: string, candles: Candle[], maxBars: number) {
  const buffer = buffers.get(key);
  if (!buffer) return;
  const normalized = normalizeCandles(candles).map(bar => ({ ...bar, isFinal: true }));
  buffer.bars = enforceBarLimit(normalized, maxBars);
  buffer.lastMergeTime = Date.now();
}

/**
 * Merge backfilled bars with existing buffer, handling race conditions.
 * Uses a lock to prevent concurrent modifications and deduplicates properly.
 */
export async function mergeBarsAsync(key: string, backfilled: Candle[], maxBars: number): Promise<void> {
  // Wait for any pending merge to complete
  const pendingMerge = mergeLocks.get(key);
  if (pendingMerge) {
    await pendingMerge;
  }

  const mergePromise = (async () => {
    mergeBarsSync(key, backfilled, maxBars);
  })();

  mergeLocks.set(key, mergePromise);
  await mergePromise;
  mergeLocks.delete(key);
}

/**
 * Synchronous merge for backwards compatibility.
 */
export function mergeBars(key: string, backfilled: Candle[], maxBars: number) {
  mergeBarsSync(key, backfilled, maxBars);
}

function mergeBarsSync(key: string, backfilled: Candle[], maxBars: number) {
  const buffer = buffers.get(key);
  if (!buffer) return;

  const backfilledFinal = normalizeCandles(backfilled).map(bar => ({ ...bar, isFinal: true }));
  const lastBackfill = backfilledFinal.at(-1);

  if (!lastBackfill) {
    // If backfill is empty, don't wipe potentially live bars unless we are sure.
    return;
  }

  // Create a map for efficient deduplication - prefer live data over backfill
  const candleMap = new Map<number, Candle>();

  // Add backfilled bars first
  for (const bar of backfilledFinal) {
    candleMap.set(bar.t, bar);
  }

  // Then overlay existing bars (live data takes precedence for same timestamp)
  for (const bar of buffer.bars) {
    const existing = candleMap.get(bar.t);
    // Prefer live source over backfill, or non-final over final (more recent)
    if (!existing || bar.source === 'live' || !bar.isFinal) {
      candleMap.set(bar.t, bar);
    }
  }

  // Convert back to sorted array
  const combined = Array.from(candleMap.values()).sort((a, b) => a.t - b.t);
  buffer.bars = enforceBarLimit(combined, maxBars);
  buffer.lastMergeTime = Date.now();
}

export function upsertCandle(key: string, candle: Candle, maxBars: number) {
  const buffer = buffers.get(key);
  if (!buffer) return;
  const existingIndex = buffer.bars.findIndex(bar => bar.t === candle.t);
  if (existingIndex >= 0) {
    buffer.bars[existingIndex] = candle;
  } else {
    const last = buffer.bars.at(-1);
    if (last && candle.t < last.t) {
      return;
    }
    buffer.bars.push(candle);
  }
  buffer.bars.sort((a, b) => a.t - b.t);
  buffer.bars = enforceSinglePartial(buffer.bars);
  buffer.bars = enforceBarLimit(buffer.bars, maxBars);
}

export function getSnapshot(key: string): BufferSnapshot | null {
  const buffer = buffers.get(key);
  if (!buffer) return null;
  const lastTimestamp = buffer.bars.at(-1)?.t ?? null;
  return {
    bars: buffer.bars.slice(),
    health: buildHealth(buffer.healthMeta, lastTimestamp)
  };
}

/**
 * Get statistics for a specific buffer (for diagnostics).
 */
export function getBufferStats(key: string): BufferStats | null {
  const buffer = buffers.get(key);
  if (!buffer) return null;

  const partialCount = buffer.bars.filter(b => !b.isFinal).length;

  return {
    symbol: buffer.symbol,
    timeframe: buffer.timeframe,
    barCount: buffer.bars.length,
    oldestTimestamp: buffer.bars[0]?.t ?? null,
    newestTimestamp: buffer.bars.at(-1)?.t ?? null,
    partialCount,
    healthMeta: buffer.healthMeta
  };
}

/**
 * Get all buffer statistics (for dashboard health panel).
 */
export function getAllBufferStats(): BufferStats[] {
  const stats: BufferStats[] = [];
  for (const [key, buffer] of buffers) {
    const partialCount = buffer.bars.filter(b => !b.isFinal).length;
    stats.push({
      symbol: buffer.symbol,
      timeframe: buffer.timeframe,
      barCount: buffer.bars.length,
      oldestTimestamp: buffer.bars[0]?.t ?? null,
      newestTimestamp: buffer.bars.at(-1)?.t ?? null,
      partialCount,
      healthMeta: buffer.healthMeta
    });
  }
  return stats;
}

/**
 * Build full DataQualityMetrics for a buffer (for dashboard).
 */
export function buildDataQualityMetrics(key: string): DataQualityMetrics | null {
  const buffer = buffers.get(key);
  if (!buffer) return null;

  const lastTimestamp = buffer.bars.at(-1)?.t ?? null;
  const lastUpdateMsAgo = lastTimestamp != null ? Date.now() - lastTimestamp : null;

  return {
    symbol: buffer.symbol,
    timeframe: buffer.timeframe,
    mode: buffer.healthMeta?.mode ?? 'DEGRADED' as HealthMode,
    source: buffer.healthMeta?.source ?? 'cache' as HealthSource,
    barCount: buffer.bars.length,
    gapsDetected: buffer.healthMeta?.gapsDetected ?? 0,
    lastUpdateMsAgo,
    lastTimestamp,
    anomalyCount: buffer.anomalyCount,
    providerThrottled: buffer.healthMeta?.providerThrottled ?? false,
    updatedAt: buffer.lastMergeTime
  };
}

/**
 * Get all DataQualityMetrics for dashboard display.
 */
export function getAllDataQualityMetrics(): DataQualityMetrics[] {
  const metrics: DataQualityMetrics[] = [];
  for (const key of buffers.keys()) {
    const m = buildDataQualityMetrics(key);
    if (m) metrics.push(m);
  }
  return metrics;
}

function normalizeCandles(candles: Candle[]): Candle[] {
  const byTimestamp = new Map<number, Candle>();
  candles.forEach(bar => {
    byTimestamp.set(bar.t, bar);
  });
  return Array.from(byTimestamp.values()).sort((a, b) => a.t - b.t);
}

function enforceSinglePartial(bars: Candle[]): Candle[] {
  let lastPartialIndex = -1;
  for (let i = 0; i < bars.length; i += 1) {
    if (!bars[i].isFinal) lastPartialIndex = i;
  }
  if (lastPartialIndex === -1) return bars;
  return bars.map((bar, index) => (index === lastPartialIndex ? bar : { ...bar, isFinal: true }));
}

function enforceBarLimit(bars: Candle[], maxBars: number): Candle[] {
  if (maxBars <= 0 || bars.length <= maxBars) return bars;
  return bars.slice(bars.length - maxBars);
}

