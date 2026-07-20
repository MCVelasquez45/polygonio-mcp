// Pure technical-study math for the AI orchestrator. Operates on OHLCV bars
// (ascending time order). No I/O — unit-tested directly.

export type StudyBar = {
  t: number; // epoch ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

export function ema(values: number[], period: number): number[] {
  if (values.length === 0 || period <= 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

export function rsi(closes: number[], period = 14): number | null {
  if (closes.length <= period) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const delta = closes[i] - closes[i - 1];
    if (delta >= 0) gain += delta;
    else loss -= delta;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(delta, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-delta, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function macd(closes: number[], fast = 12, slow = 26, signal = 9): {
  macd: number | null;
  signal: number | null;
  histogram: number | null;
} {
  if (closes.length < slow + signal) return { macd: null, signal: null, histogram: null };
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine = emaFast.map((value, i) => value - emaSlow[i]);
  const signalLine = ema(macdLine.slice(slow - 1), signal);
  const macdLast = macdLine[macdLine.length - 1];
  const signalLast = signalLine[signalLine.length - 1];
  return { macd: macdLast, signal: signalLast, histogram: macdLast - signalLast };
}

export function bollinger(closes: number[], period = 20, mult = 2): {
  middle: number | null;
  upper: number | null;
  lower: number | null;
} {
  if (closes.length < period) return { middle: null, upper: null, lower: null };
  const window = closes.slice(-period);
  const mean = window.reduce((sum, value) => sum + value, 0) / period;
  const variance = window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  return { middle: mean, upper: mean + mult * sd, lower: mean - mult * sd };
}

export function atr(bars: StudyBar[], period = 14): number | null {
  if (bars.length <= period) return null;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const { h, l } = bars[i];
    const prevClose = bars[i - 1].c;
    trs.push(Math.max(h - l, Math.abs(h - prevClose), Math.abs(l - prevClose)));
  }
  let value = trs.slice(0, period).reduce((sum, tr) => sum + tr, 0) / period;
  for (let i = period; i < trs.length; i++) {
    value = (value * (period - 1) + trs[i]) / period;
  }
  return value;
}

export function vwap(bars: StudyBar[]): number | null {
  let pv = 0;
  let volume = 0;
  for (const bar of bars) {
    const typical = (bar.h + bar.l + bar.c) / 3;
    pv += typical * bar.v;
    volume += bar.v;
  }
  return volume > 0 ? pv / volume : null;
}

/**
 * Swing-based support/resistance: local extrema over a lookback window,
 * clustered to the most recent distinct levels.
 */
export function supportResistance(bars: StudyBar[], lookback = 3, maxLevels = 3): {
  support: number[];
  resistance: number[];
} {
  const support: number[] = [];
  const resistance: number[] = [];
  for (let i = lookback; i < bars.length - lookback; i++) {
    const window = bars.slice(i - lookback, i + lookback + 1);
    const bar = bars[i];
    if (window.every(other => bar.l <= other.l)) support.push(bar.l);
    if (window.every(other => bar.h >= other.h)) resistance.push(bar.h);
  }
  const lastClose = bars.length ? bars[bars.length - 1].c : 0;
  const nearest = (levels: number[], below: boolean) =>
    [...new Set(levels.map(level => Number(level.toFixed(2))))]
      .filter(level => (below ? level <= lastClose : level >= lastClose))
      .sort((a, b) => (below ? b - a : a - b))
      .slice(0, maxLevels);
  return { support: nearest(support, true), resistance: nearest(resistance, false) };
}

export type TechnicalSummary = {
  lastClose: number | null;
  changePercent: number | null;
  ema20: number | null;
  ema50: number | null;
  vwap: number | null;
  rsi14: number | null;
  macd: { macd: number | null; signal: number | null; histogram: number | null };
  bollinger: { middle: number | null; upper: number | null; lower: number | null };
  atr14: number | null;
  lastVolume: number | null;
  avgVolume20: number | null;
  support: number[];
  resistance: number[];
  barCount: number;
};

export function summarizeTechnicals(bars: StudyBar[]): TechnicalSummary {
  const closes = bars.map(bar => bar.c);
  const ema20Series = ema(closes, 20);
  const ema50Series = ema(closes, 50);
  const volumes = bars.map(bar => bar.v);
  const avgVolume20 =
    volumes.length >= 20 ? volumes.slice(-20).reduce((sum, value) => sum + value, 0) / 20 : null;
  const lastClose = closes.length ? closes[closes.length - 1] : null;
  const prevClose = closes.length > 1 ? closes[closes.length - 2] : null;
  return {
    lastClose,
    changePercent:
      lastClose !== null && prevClose !== null && prevClose !== 0
        ? ((lastClose - prevClose) / prevClose) * 100
        : null,
    ema20: closes.length >= 20 ? ema20Series[ema20Series.length - 1] : null,
    ema50: closes.length >= 50 ? ema50Series[ema50Series.length - 1] : null,
    vwap: vwap(bars),
    rsi14: rsi(closes, 14),
    macd: macd(closes),
    bollinger: bollinger(closes),
    atr14: atr(bars, 14),
    lastVolume: volumes.length ? volumes[volumes.length - 1] : null,
    avgVolume20,
    support: supportResistance(bars).support,
    resistance: supportResistance(bars).resistance,
    barCount: bars.length,
  };
}
