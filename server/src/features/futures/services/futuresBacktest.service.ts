import { FuturesBacktestModel } from '../models/futuresModels';
import { fetchFuturesDailyBars } from './databentoGateway.service';
import { getContractSpec } from './contractSpecs.service';

export type FuturesBacktestInput = {
  strategyId: string;
  strategyName: string;
  symbol: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  contracts: number;
  rollPolicy: 'volume' | 'calendar' | 'open_interest';
  rollDaysBefore: number;
  slippageBps: number;
  feePerContract: number;
  lookback?: number;
};

function computeSharpe(returns: number[]) {
  if (!returns.length) return 0;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length;
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return (mean / std) * Math.sqrt(252);
}

function buildRollEvents(startDate: string, endDate: string, symbol: string, rollPolicy: FuturesBacktestInput['rollPolicy']) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const events: Array<{ timestamp: string; fromContract: string; toContract: string; reason: string }> = [];
  let idx = 1;
  for (let date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 35)) {
    if (events.length > 12) break;
    const fromContract = `${symbol}${String(idx).padStart(2, '0')}`;
    const toContract = `${symbol}${String(idx + 1).padStart(2, '0')}`;
    events.push({
      timestamp: new Date(date).toISOString(),
      fromContract,
      toContract,
      reason: `${rollPolicy} roll`
    });
    idx += 1;
  }
  return events;
}

export async function runFuturesBacktest(input: FuturesBacktestInput) {
  const spec = await getContractSpec(input.symbol);
  if (!spec) {
    throw new Error(`Unsupported futures symbol: ${input.symbol}`);
  }

  const barsResponse = await fetchFuturesDailyBars({
    symbol: input.symbol,
    startDate: input.startDate,
    endDate: input.endDate
  });

  const bars = barsResponse.bars;
  if (!bars.length) {
    throw new Error('No bars available for backtest window.');
  }

  const lookback = Math.max(2, input.lookback ?? 10);
  let cash = input.initialCapital;
  let equity = input.initialCapital;
  let position: 1 | -1 | 0 = 0;
  let entryPrice = bars[0].close;
  const contracts = Math.max(1, input.contracts);

  const equityCurve: Array<{ timestamp: string; equity: number }> = [];
  const tradeLedger: Array<{
    timestamp: string;
    side: 'buy' | 'sell';
    contracts: number;
    fillPrice: number;
    pnl: number;
    reason: string;
  }> = [];
  const dailyReturns: number[] = [];

  let peakEquity = input.initialCapital;
  let maxDrawdownPct = 0;
  let wins = 0;

  for (let i = 0; i < bars.length; i += 1) {
    const bar = bars[i];
    const history = bars.slice(Math.max(0, i - lookback), i + 1);
    const sma = history.reduce((sum, item) => sum + item.close, 0) / history.length;

    let signal: 1 | -1 | 0 = position;
    if (bar.close > sma * 1.0025) signal = 1;
    else if (bar.close < sma * 0.9975) signal = -1;

    const fee = input.feePerContract * contracts;
    const slippageMultiplier = input.slippageBps / 10000;

    if (signal !== position) {
      if (position !== 0) {
        const grossPoints = (bar.close - entryPrice) * position;
        const grossPnl = grossPoints * spec.contractMultiplier * contracts;
        const slip = Math.abs(bar.close * slippageMultiplier * spec.contractMultiplier * contracts);
        const pnl = grossPnl - slip - fee;
        cash += pnl;
        wins += pnl > 0 ? 1 : 0;
        tradeLedger.push({
          timestamp: bar.timestamp,
          side: position === 1 ? 'sell' : 'buy',
          contracts,
          fillPrice: bar.close,
          pnl,
          reason: 'signal flip exit'
        });
      }

      if (signal !== 0) {
        entryPrice = bar.close;
        tradeLedger.push({
          timestamp: bar.timestamp,
          side: signal === 1 ? 'buy' : 'sell',
          contracts,
          fillPrice: bar.close,
          pnl: 0,
          reason: 'signal flip entry'
        });
      }

      position = signal;
    }

    const unrealized =
      position === 0 ? 0 : (bar.close - entryPrice) * position * spec.contractMultiplier * contracts;
    const previousEquity = equity;
    equity = cash + unrealized;
    equityCurve.push({ timestamp: bar.timestamp, equity });

    const r = previousEquity > 0 ? (equity - previousEquity) / previousEquity : 0;
    dailyReturns.push(r);

    if (equity > peakEquity) peakEquity = equity;
    const dd = peakEquity > 0 ? (peakEquity - equity) / peakEquity : 0;
    if (dd > maxDrawdownPct) maxDrawdownPct = dd;
  }

  const totalPnl = equity - input.initialCapital;
  const totalReturnPct = input.initialCapital > 0 ? totalPnl / input.initialCapital : 0;
  const closedTrades = tradeLedger.filter(item => item.reason.includes('exit'));
  const winRatePct = closedTrades.length ? wins / closedTrades.length : 0;
  const rollEvents = buildRollEvents(input.startDate, input.endDate, input.symbol, input.rollPolicy);

  const saved = await FuturesBacktestModel.create({
    strategyId: input.strategyId,
    strategyName: input.strategyName,
    symbol: input.symbol,
    provider: barsResponse.provider,
    config: {
      startDate: input.startDate,
      endDate: input.endDate,
      initialCapital: input.initialCapital,
      contracts,
      rollPolicy: input.rollPolicy,
      rollDaysBefore: input.rollDaysBefore,
      slippageBps: input.slippageBps,
      feePerContract: input.feePerContract
    },
    diagnostics: {
      usedFallbackData: barsResponse.usedFallbackData,
      sourceMessage: barsResponse.sourceMessage,
      barsLoaded: bars.length
    },
    metrics: {
      totalReturnPct,
      sharpeRatio: computeSharpe(dailyReturns),
      maxDrawdownPct,
      winRatePct,
      totalPnl,
      tradeCount: closedTrades.length
    },
    equityCurve,
    tradeLedger,
    rollEvents
  });

  return saved.toObject();
}

export async function getFuturesBacktest(backtestId: string) {
  return FuturesBacktestModel.findById(backtestId).lean();
}
