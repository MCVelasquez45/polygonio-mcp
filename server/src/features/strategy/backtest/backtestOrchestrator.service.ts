import { getStockBars, type NormalizedMarketBar } from '../../marketData/massiveProvider';
import {
  assertStrategyRuntimeSpec,
  type BacktestResult,
  type BacktestTrade,
  type ConditionOperator,
  type StrategyField,
  type StrategyRuntimeRule,
  type StrategyRuntimeSpec
} from '../types';

type BacktestBar = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

const SLIPPAGE = 0.0005;
const NEW_YORK_TIME_ZONE = 'America/New_York';
const etDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: NEW_YORK_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});
const etTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: NEW_YORK_TIME_ZONE,
  hour12: false,
  hour: '2-digit',
  minute: '2-digit'
});

function normalizeBars(rawBars: NormalizedMarketBar[]): BacktestBar[] {
  return rawBars
    .filter(bar =>
      Number.isFinite(bar.timestamp) &&
      Number.isFinite(bar.open) &&
      Number.isFinite(bar.high) &&
      Number.isFinite(bar.low) &&
      Number.isFinite(bar.close) &&
      Number.isFinite(bar.volume)
    )
    .slice()
    .sort((left, right) => left.timestamp - right.timestamp)
    .map(bar => ({
      timestamp: new Date(bar.timestamp).toISOString(),
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume
    }));
}

function getEtSessionDate(timestamp: string) {
  return etDateFormatter.format(new Date(timestamp));
}

function getEtMinutes(timestamp: string) {
  const formatted = etTimeFormatter.format(new Date(timestamp));
  const [hours, minutes] = formatted.split(':').map(value => Number(value));
  return hours * 60 + minutes;
}

function isRegularMarket(bar: BacktestBar) {
  const totalMinutes = getEtMinutes(bar.timestamp);
  return totalMinutes >= 9 * 60 + 30 && totalMinutes <= 16 * 60;
}

function resolveBacktestTicker(runtimeSpec: StrategyRuntimeSpec) {
  const runtimeSpecWithSymbol = runtimeSpec as StrategyRuntimeSpec & { symbol?: string | null };
  return (runtimeSpecWithSymbol.symbol || process.env.STRATEGY_BACKTEST_TICKER || 'SPY').trim().toUpperCase();
}

function resolveBacktestRange() {
  return {
    multiplier: 1 as const,
    timespan: 'minute' as const,
    from: process.env.STRATEGY_BACKTEST_FROM || '2024-01-01',
    to: process.env.STRATEGY_BACKTEST_TO || '2024-01-02'
  };
}

function computeWilderRsi(closes: number[], period = 14): Array<number | null> {
  const result: Array<number | null> = Array(closes.length).fill(null);
  if (closes.length <= period) {
    return result;
  }

  let gain = 0;
  let loss = 0;

  for (let i = 1; i <= period; i += 1) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }

  let avgGain = gain / period;
  let avgLoss = loss / period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i += 1) {
    const diff = closes[i] - closes[i - 1];
    const currentGain = diff > 0 ? diff : 0;
    const currentLoss = diff < 0 ? -diff : 0;

    avgGain = (avgGain * (period - 1) + currentGain) / period;
    avgLoss = (avgLoss * (period - 1) + currentLoss) / period;

    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return result;
}

function computeSessionVwap(bars: BacktestBar[]): number[] {
  let cumulativePV = 0;
  let cumulativeVol = 0;
  let currentSessionDate: string | null = null;

  return bars.map(bar => {
    const sessionDate = getEtSessionDate(bar.timestamp);

    if (sessionDate !== currentSessionDate) {
      cumulativePV = 0;
      cumulativeVol = 0;
      currentSessionDate = sessionDate;
    }

    const typicalPrice = (bar.high + bar.low + bar.close) / 3;
    cumulativePV += typicalPrice * bar.volume;
    cumulativeVol += bar.volume;

    return cumulativeVol > 0 ? cumulativePV / cumulativeVol : bar.close;
  });
}

function computeEma(closes: number[], period: number): Array<number | null> {
  const multiplier = 2 / (period + 1);
  const result: Array<number | null> = Array(closes.length).fill(null);
  let ema: number | null = null;
  closes.forEach((close, index) => {
    ema = ema == null ? close : (close - ema) * multiplier + ema;
    result[index] = ema;
  });
  return result;
}

function resolveFieldValue(
  field: StrategyField,
  index: number,
  bars: BacktestBar[],
  indicators: Record<string, Array<number | null>>
): number | null {
  switch (field) {
    case 'PRICE':
      return bars[index]?.close ?? null;
    case 'VWAP':
      return indicators.VWAP[index] ?? null;
    case 'RSI':
      return indicators.RSI[index] ?? null;
    case 'EMA_9':
      return indicators.EMA_9[index] ?? null;
    case 'EMA_20':
      return indicators.EMA_20[index] ?? null;
    case 'MACD': {
      const fast = indicators.EMA_9[index];
      const slow = indicators.EMA_20[index];
      return fast != null && slow != null ? fast - slow : null;
    }
    case 'SIGNAL':
      return indicators.SIGNAL[index] ?? null;
    default:
      return null;
  }
}

function compare(operator: ConditionOperator, left: number, right: number): boolean {
  switch (operator) {
    case 'lt':
      return left < right;
    case 'lte':
      return left <= right;
    case 'gt':
      return left > right;
    case 'gte':
      return left >= right;
    case 'eq':
      return Math.abs(left - right) < 1e-6;
    default:
      return false;
  }
}

function evaluateRule(
  rule: StrategyRuntimeRule,
  index: number,
  bars: BacktestBar[],
  indicators: Record<string, Array<number | null>>
): boolean {
  const current = resolveFieldValue(rule.field, index, bars, indicators);
  if (current == null) return false;

  const value =
    typeof rule.value === 'string'
      ? resolveFieldValue(rule.value, index, bars, indicators)
      : typeof rule.value === 'number'
        ? rule.value
        : null;

  if (rule.operator === 'touches') {
    if (value == null) return false;
    return Math.abs(current - value) / Math.max(Math.abs(value), 1) <= 0.0025;
  }

  if (rule.operator === 'crosses_above' || rule.operator === 'crosses_below') {
    if (index === 0 || value == null) return false;
    const prevCurrent = resolveFieldValue(rule.field, index - 1, bars, indicators);
    const prevValue =
      typeof rule.value === 'string'
        ? resolveFieldValue(rule.value, index - 1, bars, indicators)
        : typeof rule.value === 'number'
          ? rule.value
          : null;
    if (prevCurrent == null || prevValue == null) return false;
    return rule.operator === 'crosses_above'
      ? prevCurrent <= prevValue && current > value
      : prevCurrent >= prevValue && current < value;
  }

  if (value == null) return false;
  return compare(rule.operator, current, value);
}

function getEntryPrice(close: number, direction: number) {
  return direction > 0 ? close * (1 + SLIPPAGE) : close * (1 - SLIPPAGE);
}

function getExitPrice(close: number, direction: number) {
  return direction > 0 ? close * (1 - SLIPPAGE) : close * (1 + SLIPPAGE);
}

export async function runBacktest(runtimeSpec: StrategyRuntimeSpec, _seedKey: string): Promise<BacktestResult> {
  assertStrategyRuntimeSpec(runtimeSpec);

  const ticker = resolveBacktestTicker(runtimeSpec);
  const range = resolveBacktestRange();
  const rawBars = await getStockBars({
    ticker,
    multiplier: range.multiplier,
    timespan: range.timespan,
    from: range.from,
    to: range.to
  });
  const bars = normalizeBars(rawBars);
  const filteredBars = bars.filter(isRegularMarket);

  if (filteredBars.length < 21) {
    throw new Error(
      `Backtest requires at least 21 regular-session bars. Massive returned ${filteredBars.length} bars for ${ticker}.`
    );
  }

  const closes = filteredBars.map(bar => bar.close);
  const ema9 = computeEma(closes, 9);
  const ema20 = computeEma(closes, 20);
  const macdSeries = closes.map((_, index) => {
    const fast = ema9[index];
    const slow = ema20[index];
    if (fast == null || slow == null) return 0;
    return fast - slow;
  });
  const indicators = {
    RSI: computeWilderRsi(closes),
    VWAP: computeSessionVwap(filteredBars),
    EMA_9: ema9,
    EMA_20: ema20,
    SIGNAL: computeEma(macdSeries, 9)
  };

  const trades: BacktestTrade[] = [];
  const direction = runtimeSpec.execution.action === 'BUY' ? 1 : -1;
  let activeTrade: {
    entryIndex: number;
    entryPrice: number;
    side: 'long' | 'short';
  } | null = null;

  for (let index = 20; index < filteredBars.length; index += 1) {
    const bar = filteredBars[index];
    const entryMatched = runtimeSpec.rules.entry.every(rule => evaluateRule(rule, index, filteredBars, indicators));
    const exitMatched = runtimeSpec.rules.exit.every(rule => evaluateRule(rule, index, filteredBars, indicators));

    if (!activeTrade && entryMatched) {
      activeTrade = {
        entryIndex: index,
        entryPrice: getEntryPrice(bar.close, direction),
        side: direction > 0 ? 'long' : 'short'
      };
      continue;
    }

    if (!activeTrade) continue;

    const exitPrice = getExitPrice(bar.close, direction);
    const rawReturn = direction > 0
      ? (exitPrice - activeTrade.entryPrice) / activeTrade.entryPrice
      : (activeTrade.entryPrice - exitPrice) / activeTrade.entryPrice;

    const hitTakeProfit = rawReturn >= runtimeSpec.riskManagement.takeProfitPct;
    const hitStopLoss = rawReturn <= -runtimeSpec.riskManagement.stopLossPct;
    const hitMaxBars = index - activeTrade.entryIndex >= runtimeSpec.riskManagement.maxBarsInTrade;
    const shouldExit = exitMatched || hitTakeProfit || hitStopLoss || hitMaxBars;

    if (!shouldExit) continue;

    trades.push({
      entryTime: filteredBars[activeTrade.entryIndex].timestamp,
      exitTime: bar.timestamp,
      side: activeTrade.side,
      entryAction: runtimeSpec.execution.action,
      exitAction: 'EXIT',
      entryPrice: activeTrade.entryPrice,
      exitPrice,
      pnl: Number((rawReturn * 100).toFixed(2)),
      barsHeld: index - activeTrade.entryIndex,
      reason: exitMatched ? 'rule_exit' : hitTakeProfit ? 'take_profit' : hitStopLoss ? 'stop_loss' : 'max_bars'
    });
    activeTrade = null;
  }

  if (activeTrade) {
    const lastBar = filteredBars.at(-1);
    if (lastBar) {
      const exitPrice = getExitPrice(lastBar.close, direction);
      const rawReturn = direction > 0
        ? (exitPrice - activeTrade.entryPrice) / activeTrade.entryPrice
        : (activeTrade.entryPrice - exitPrice) / activeTrade.entryPrice;
      trades.push({
        entryTime: filteredBars[activeTrade.entryIndex].timestamp,
        exitTime: lastBar.timestamp,
        side: activeTrade.side,
        entryAction: runtimeSpec.execution.action,
        exitAction: 'EXIT',
        entryPrice: activeTrade.entryPrice,
        exitPrice,
        pnl: Number((rawReturn * 100).toFixed(2)),
        barsHeld: filteredBars.length - 1 - activeTrade.entryIndex,
        reason: 'end_of_test'
      });
    }
  }

  const pnl = Number(trades.reduce((sum, trade) => sum + trade.pnl, 0).toFixed(2));
  const winners = trades.filter(trade => trade.pnl > 0).length;
  const winRate = trades.length ? Number(((winners / trades.length) * 100).toFixed(2)) : 0;

  return {
    pnl,
    winRate,
    trades,
    totalTrades: trades.length
  };
}

export const runMockBacktest = runBacktest;
