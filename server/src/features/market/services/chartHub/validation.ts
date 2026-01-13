import type { Candle } from './buffer';

export function isValidCandle(candle: Candle): boolean {
  const values = [candle.o, candle.h, candle.l, candle.c, candle.v];
  if (!values.every(value => Number.isFinite(value))) return false;
  if (candle.h < Math.max(candle.o, candle.c)) return false;
  if (candle.l > Math.min(candle.o, candle.c)) return false;
  if (candle.v < 0) return false;
  return Number.isFinite(candle.t) && candle.t > 0;
}

export function countGaps(bars: Candle[], expectedMs: number): number {
  if (bars.length < 2) return 0;
  const sorted = bars.slice().sort((a, b) => a.t - b.t);
  let gaps = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    const diff = sorted[i].t - sorted[i - 1].t;
    if (diff > expectedMs * 1.5) {
      gaps += Math.max(0, Math.floor(diff / expectedMs) - 1);
    }
  }
  return gaps;
}
