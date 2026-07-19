import {
  computeATR,
  computeEMA,
  computeRSI,
} from '../../futures/services/signalEngine.service';
import type { AutomationStrategyConfig } from '../automation.config';

// Deterministic indicator adapter.
//
// EMA / RSI / ATR are REUSED from the canonical rule engine
// (features/futures/services/signalEngine.service.ts) — not reimplemented.
// VWAP and the rolling volume average do not exist elsewhere in the server
// and are implemented here, session-anchored and pure.

export type AutomationBar = {
  /** Bar START time, epoch ms. */
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type IndicatorSnapshot = {
  close: number | null;
  vwap: number | null;
  emaFast: number | null;
  emaSlow: number | null;
  rsi: number | null;
  atr: number | null;
  barVolume: number | null;
  rollingVolumeAvg: number | null;
};

function toFuturesBars(bars: AutomationBar[]) {
  return bars.map(bar => ({
    timestamp: new Date(bar.timestamp).toISOString(),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  }));
}

/**
 * Session-anchored VWAP: cumulative Σ(typicalPrice×volume)/Σ(volume) over the
 * bars belonging to the SAME session as the last bar. A gap larger than
 * `sessionGapMs` marks a session boundary.
 */
export function computeSessionVwap(bars: AutomationBar[], sessionGapMs: number): number | null {
  if (!bars.length) return null;
  // Find the start of the current session by walking back from the end.
  let start = bars.length - 1;
  while (start > 0 && bars[start].timestamp - bars[start - 1].timestamp <= sessionGapMs) {
    start -= 1;
  }
  let pvSum = 0;
  let volSum = 0;
  for (let i = start; i < bars.length; i += 1) {
    const bar = bars[i];
    const typical = (bar.high + bar.low + bar.close) / 3;
    pvSum += typical * bar.volume;
    volSum += bar.volume;
  }
  return volSum > 0 ? pvSum / volSum : null;
}

/** Simple average of the previous `window` bar volumes, EXCLUDING the last bar. */
export function computeRollingVolumeAvg(bars: AutomationBar[], window: number): number | null {
  if (bars.length < 2) return null;
  const prior = bars.slice(0, -1).slice(-window);
  if (!prior.length) return null;
  return prior.reduce((sum, bar) => sum + bar.volume, 0) / prior.length;
}

/**
 * Compute the full deterministic snapshot for the LAST bar in `bars`.
 * Pure: same bars + config → same snapshot, always.
 */
export function computeIndicatorSnapshot(
  bars: AutomationBar[],
  config: AutomationStrategyConfig
): IndicatorSnapshot {
  if (!bars.length) {
    return {
      close: null,
      vwap: null,
      emaFast: null,
      emaSlow: null,
      rsi: null,
      atr: null,
      barVolume: null,
      rollingVolumeAvg: null,
    };
  }
  const futuresBars = toFuturesBars(bars);
  const last = bars[bars.length - 1];
  return {
    close: last.close,
    vwap: computeSessionVwap(bars, config.sessionGapMs),
    emaFast: computeEMA(futuresBars, config.indicators.emaFast),
    emaSlow: computeEMA(futuresBars, config.indicators.emaSlow),
    rsi: computeRSI(futuresBars, config.indicators.rsiPeriod),
    atr: computeATR(futuresBars, config.indicators.atrPeriod),
    barVolume: last.volume,
    rollingVolumeAvg: computeRollingVolumeAvg(bars, config.indicators.volumeAvgWindow),
  };
}
