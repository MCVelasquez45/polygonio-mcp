import type { Candle } from './buffer';
import { logDataQualityEvent } from './health';

export type CandleAnomaly = {
  type: 'invalid_ohlc' | 'negative_volume' | 'invalid_timestamp' | 'extreme_move' | 'zero_range';
  message: string;
  candle: Candle;
};

/**
 * Basic OHLC sanity check: H >= max(O,C), L <= min(O,C)
 */
export function isValidCandle(candle: Candle): boolean {
  const values = [candle.o, candle.h, candle.l, candle.c, candle.v];
  if (!values.every(value => Number.isFinite(value))) return false;
  if (candle.h < Math.max(candle.o, candle.c)) return false;
  if (candle.l > Math.min(candle.o, candle.c)) return false;
  if (candle.v < 0) return false;
  return Number.isFinite(candle.t) && candle.t > 0;
}

/**
 * Detailed anomaly detection with structured results.
 */
export function detectCandleAnomalies(candle: Candle, symbol: string): CandleAnomaly[] {
  const anomalies: CandleAnomaly[] = [];

  // OHLC relationship check
  if (candle.h < Math.max(candle.o, candle.c)) {
    anomalies.push({
      type: 'invalid_ohlc',
      message: `High (${candle.h}) is less than max of Open/Close (${Math.max(candle.o, candle.c)})`,
      candle
    });
  }
  if (candle.l > Math.min(candle.o, candle.c)) {
    anomalies.push({
      type: 'invalid_ohlc',
      message: `Low (${candle.l}) is greater than min of Open/Close (${Math.min(candle.o, candle.c)})`,
      candle
    });
  }

  // Negative volume
  if (candle.v < 0) {
    anomalies.push({
      type: 'negative_volume',
      message: `Negative volume: ${candle.v}`,
      candle
    });
  }

  // Invalid timestamp
  if (!Number.isFinite(candle.t) || candle.t <= 0) {
    anomalies.push({
      type: 'invalid_timestamp',
      message: `Invalid timestamp: ${candle.t}`,
      candle
    });
  }

  // Zero range candle (suspicious in active trading)
  if (candle.h === candle.l && candle.v > 0) {
    anomalies.push({
      type: 'zero_range',
      message: `Zero range candle with volume ${candle.v}`,
      candle
    });
  }

  // Extreme move (>20% in a single candle - likely bad data)
  const range = candle.h - candle.l;
  const mid = (candle.h + candle.l) / 2;
  if (mid > 0 && range / mid > 0.20) {
    anomalies.push({
      type: 'extreme_move',
      message: `Extreme range: ${((range / mid) * 100).toFixed(1)}% of price`,
      candle
    });
  }

  return anomalies;
}

/**
 * Validate and log anomalies for a candle. Returns true if valid.
 */
export function validateAndLogCandle(candle: Candle, symbol: string, timeframe: string): boolean {
  const anomalies = detectCandleAnomalies(candle, symbol);

  if (anomalies.length > 0) {
    for (const anomaly of anomalies) {
      logDataQualityEvent({
        type: 'anomaly',
        symbol,
        timeframe,
        message: anomaly.message,
        details: {
          anomalyType: anomaly.type,
          timestamp: candle.t,
          ohlcv: { o: candle.o, h: candle.h, l: candle.l, c: candle.c, v: candle.v }
        }
      });
    }
    return false;
  }

  return isValidCandle(candle);
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

/**
 * Detect gaps and log them with details. Returns gap info for UI display.
 */
export function detectAndLogGaps(
  bars: Candle[],
  expectedMs: number,
  symbol: string,
  timeframe: string
): { gapCount: number; gapRanges: Array<{ from: number; to: number; missingBars: number }> } {
  const gapRanges: Array<{ from: number; to: number; missingBars: number }> = [];

  if (bars.length < 2) return { gapCount: 0, gapRanges };

  const sorted = bars.slice().sort((a, b) => a.t - b.t);
  let totalGaps = 0;

  for (let i = 1; i < sorted.length; i += 1) {
    const diff = sorted[i].t - sorted[i - 1].t;
    if (diff > expectedMs * 1.5) {
      const missingBars = Math.max(0, Math.floor(diff / expectedMs) - 1);
      totalGaps += missingBars;

      gapRanges.push({
        from: sorted[i - 1].t,
        to: sorted[i].t,
        missingBars
      });

      logDataQualityEvent({
        type: 'gap_detected',
        symbol,
        timeframe,
        message: `Gap of ${missingBars} bars detected`,
        details: {
          fromTimestamp: sorted[i - 1].t,
          toTimestamp: sorted[i].t,
          expectedMs,
          actualMs: diff
        }
      });
    }
  }

  return { gapCount: totalGaps, gapRanges };
}

/**
 * Check timestamp continuity - ensure bars are in order with no duplicates.
 */
export function validateTimestampContinuity(bars: Candle[]): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  if (bars.length < 2) return { valid: true, issues };

  const sorted = bars.slice().sort((a, b) => a.t - b.t);
  const seen = new Set<number>();

  for (const bar of sorted) {
    if (seen.has(bar.t)) {
      issues.push(`Duplicate timestamp: ${bar.t}`);
    }
    seen.add(bar.t);
  }

  // Check if bars were out of order in original array
  for (let i = 1; i < bars.length; i++) {
    if (bars[i].t < bars[i - 1].t) {
      issues.push(`Out-of-order bar at index ${i}: ${bars[i].t} < ${bars[i - 1].t}`);
    }
  }

  return { valid: issues.length === 0, issues };
}

