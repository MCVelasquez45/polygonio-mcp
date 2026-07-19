import type { HistogramData, LineData, UTCTimestamp, WhitespaceData } from 'lightweight-charts';
import type { AggregateBar } from '../types/market';

/**
 * Pure indicator math over aggregate bars for the chart workspace. Each series
 * emits whitespace points during warm-up so lightweight-charts keeps the time
 * axis aligned with the candles. All values derive from the real bars — no
 * seeding, no synthetic smoothing beyond each indicator's definition.
 */

export type LinePoint = LineData<UTCTimestamp> | WhitespaceData<UTCTimestamp>;

const toTime = (timestamp: number) => Math.floor(timestamp / 1000) as UTCTimestamp;

export function computeEma(bars: AggregateBar[], period: number): LinePoint[] {
  const result: LinePoint[] = [];
  if (period <= 0) return result;
  const k = 2 / (period + 1);
  let ema: number | null = null;
  let warmupSum = 0;
  for (let i = 0; i < bars.length; i += 1) {
    const bar = bars[i];
    if (i < period - 1) {
      warmupSum += bar.close;
      result.push({ time: toTime(bar.timestamp) });
      continue;
    }
    if (ema == null) {
      warmupSum += bar.close;
      ema = warmupSum / period;
    } else {
      ema = bar.close * k + ema * (1 - k);
    }
    result.push({ time: toTime(bar.timestamp), value: ema });
  }
  return result;
}

const NY_DAY_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Session VWAP: cumulative Σ(typical·volume)/Σ(volume), reset at each New
 * York trading day boundary. On daily bars this degrades gracefully to a
 * running per-day typical price, which is not meaningful — callers should
 * only enable VWAP on intraday timeframes.
 */
export function computeSessionVwap(bars: AggregateBar[]): LinePoint[] {
  const result: LinePoint[] = [];
  let dayKey: string | null = null;
  let cumPv = 0;
  let cumVol = 0;
  for (const bar of bars) {
    const key = NY_DAY_FORMATTER.format(new Date(bar.timestamp));
    if (key !== dayKey) {
      dayKey = key;
      cumPv = 0;
      cumVol = 0;
    }
    const typical = (bar.high + bar.low + bar.close) / 3;
    cumPv += typical * bar.volume;
    cumVol += bar.volume;
    if (cumVol > 0) {
      result.push({ time: toTime(bar.timestamp), value: cumPv / cumVol });
    } else {
      result.push({ time: toTime(bar.timestamp) });
    }
  }
  return result;
}

export type BollingerSeries = { upper: LinePoint[]; middle: LinePoint[]; lower: LinePoint[] };

export function computeBollinger(bars: AggregateBar[], period = 20, mult = 2): BollingerSeries {
  const upper: LinePoint[] = [];
  const middle: LinePoint[] = [];
  const lower: LinePoint[] = [];
  for (let i = 0; i < bars.length; i += 1) {
    const time = toTime(bars[i].timestamp);
    if (i < period - 1) {
      upper.push({ time });
      middle.push({ time });
      lower.push({ time });
      continue;
    }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j += 1) sum += bars[j].close;
    const mean = sum / period;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j += 1) {
      const diff = bars[j].close - mean;
      variance += diff * diff;
    }
    const sd = Math.sqrt(variance / period);
    upper.push({ time, value: mean + mult * sd });
    middle.push({ time, value: mean });
    lower.push({ time, value: mean - mult * sd });
  }
  return { upper, middle, lower };
}

/** RSI with Wilder's smoothing. Values 0–100; warm-up is whitespace. */
export function computeRsi(bars: AggregateBar[], period = 14): LinePoint[] {
  const result: LinePoint[] = [];
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < bars.length; i += 1) {
    const time = toTime(bars[i].timestamp);
    if (i === 0) {
      result.push({ time });
      continue;
    }
    const change = bars[i].close - bars[i - 1].close;
    const gain = Math.max(0, change);
    const loss = Math.max(0, -change);
    if (i <= period) {
      avgGain += gain / period;
      avgLoss += loss / period;
      result.push({ time });
      continue;
    }
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs = avgLoss === 0 ? Number.POSITIVE_INFINITY : avgGain / avgLoss;
    const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
    result.push({ time, value: rsi });
  }
  return result;
}

export type MacdSeries = {
  macd: LinePoint[];
  signal: LinePoint[];
  histogram: Array<HistogramData<UTCTimestamp> | WhitespaceData<UTCTimestamp>>;
};

export function computeMacd(
  bars: AggregateBar[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
  colors: { pos: string; neg: string } = { pos: 'rgba(53,210,154,0.6)', neg: 'rgba(248,113,113,0.6)' }
): MacdSeries {
  const fastEma = computeEma(bars, fast);
  const slowEma = computeEma(bars, slow);
  const macd: LinePoint[] = [];
  const macdValues: Array<number | null> = [];
  for (let i = 0; i < bars.length; i += 1) {
    const time = toTime(bars[i].timestamp);
    const f = (fastEma[i] as LineData<UTCTimestamp>).value;
    const s = (slowEma[i] as LineData<UTCTimestamp>).value;
    if (f == null || s == null) {
      macd.push({ time });
      macdValues.push(null);
    } else {
      const value = f - s;
      macd.push({ time, value });
      macdValues.push(value);
    }
  }
  // Signal: EMA of the MACD line, seeded once `signalPeriod` values exist.
  const signal: LinePoint[] = [];
  const k = 2 / (signalPeriod + 1);
  let sig: number | null = null;
  let seen: number[] = [];
  for (let i = 0; i < bars.length; i += 1) {
    const time = toTime(bars[i].timestamp);
    const value = macdValues[i];
    if (value == null) {
      signal.push({ time });
      continue;
    }
    if (sig == null) {
      seen.push(value);
      if (seen.length < signalPeriod) {
        signal.push({ time });
        continue;
      }
      sig = seen.reduce((a, b) => a + b, 0) / signalPeriod;
      seen = [];
    } else {
      sig = value * k + sig * (1 - k);
    }
    signal.push({ time, value: sig });
  }
  const histogram: MacdSeries['histogram'] = [];
  for (let i = 0; i < bars.length; i += 1) {
    const time = toTime(bars[i].timestamp);
    const m = macdValues[i];
    const s = (signal[i] as LineData<UTCTimestamp>).value;
    if (m == null || s == null) {
      histogram.push({ time });
    } else {
      const value = m - s;
      histogram.push({ time, value, color: value >= 0 ? colors.pos : colors.neg });
    }
  }
  return { macd, signal, histogram };
}
