import { buildHealth, type HealthMeta, type HealthState } from './health';

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

type BufferState = {
  symbol: string;
  timeframe: string;
  bars: Candle[];
  healthMeta: HealthMeta | null;
};

const buffers = new Map<string, BufferState>();

export function getOrCreateBuffer(key: string, symbol: string, timeframe: string): BufferState {
  const existing = buffers.get(key);
  if (existing) return existing;
  const created: BufferState = {
    symbol,
    timeframe,
    bars: [],
    healthMeta: null
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

export function replaceBars(key: string, candles: Candle[], maxBars: number) {
  const buffer = buffers.get(key);
  if (!buffer) return;
  const normalized = normalizeCandles(candles).map(bar => ({ ...bar, isFinal: true }));
  buffer.bars = enforceBarLimit(normalized, maxBars);
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
