import type { AutomationStrategyConfig } from '../automation.config';
import { REASON } from '../automation.config';
import type { SignalDirection } from '../models/tradeCandidate.model';
import type { IndicatorSnapshot } from './indicatorAdapter.service';

// The 5-minute deterministic momentum strategy (momentum-5m-v1).
// Symbol-agnostic: identical rule logic runs for every configured underlying.
//
// Pure function: (indicators, config, context) → direction | NO_TRADE with
// explicit reason codes for every failed condition. There is NO AI fallback
// and NO silent substitution of other rule logic — if the conditions don't
// match, the answer is NO_TRADE, full stop.

export type StrategyContext = {
  hasOpenAutomationPosition: boolean;
  hasUnresolvedAutomationOrder: boolean;
  dailyTradeCount: number;
  maxTradesPerDay: number;
};

export type ConditionReport = Record<string, boolean>;

export type StrategyEvaluation = {
  direction: SignalDirection | null;
  reasonCodes: string[];
  conditions: {
    bullish: ConditionReport;
    bearish: ConditionReport;
    shared: ConditionReport;
  };
};

export function evaluateStrategy(
  indicators: IndicatorSnapshot,
  config: AutomationStrategyConfig,
  context: StrategyContext
): StrategyEvaluation {
  const { close, vwap, emaFast, emaSlow, rsi, barVolume, rollingVolumeAvg } = indicators;
  const reasonCodes: string[] = [];

  const haveAll =
    close != null && vwap != null && emaFast != null && emaSlow != null && rsi != null &&
    barVolume != null && rollingVolumeAvg != null;

  const volumeOk =
    haveAll && (barVolume as number) > config.volumeMultiple * (rollingVolumeAvg as number);

  const bullish: ConditionReport = {
    closeAboveVwap: haveAll && (close as number) > (vwap as number),
    emaFastAboveSlow: haveAll && (emaFast as number) > (emaSlow as number),
    rsiInRange: haveAll && (rsi as number) >= config.bullish.rsiMin && (rsi as number) <= config.bullish.rsiMax,
    volumeAboveAverage: volumeOk,
  };
  const bearish: ConditionReport = {
    closeBelowVwap: haveAll && (close as number) < (vwap as number),
    emaFastBelowSlow: haveAll && (emaFast as number) < (emaSlow as number),
    rsiInRange: haveAll && (rsi as number) >= config.bearish.rsiMin && (rsi as number) <= config.bearish.rsiMax,
    volumeAboveAverage: volumeOk,
  };
  const shared: ConditionReport = {
    noOpenAutomationPosition: !context.hasOpenAutomationPosition,
    noUnresolvedAutomationOrder: !context.hasUnresolvedAutomationOrder,
    dailyLimitPermits: context.dailyTradeCount < context.maxTradesPerDay,
  };

  const sharedOk = shared.noOpenAutomationPosition && shared.noUnresolvedAutomationOrder && shared.dailyLimitPermits;
  const bullishOk = Object.values(bullish).every(Boolean);
  const bearishOk = Object.values(bearish).every(Boolean);

  if (!shared.noOpenAutomationPosition) reasonCodes.push(REASON.OPEN_AUTOMATION_POSITION);
  if (!shared.noUnresolvedAutomationOrder) reasonCodes.push(REASON.UNRESOLVED_AUTOMATION_ORDER);
  if (!shared.dailyLimitPermits) reasonCodes.push(REASON.DAILY_TRADE_LIMIT_REACHED);

  if (sharedOk && bullishOk) {
    return { direction: 'BULLISH', reasonCodes: [], conditions: { bullish, bearish, shared } };
  }
  if (sharedOk && bearishOk) {
    return { direction: 'BEARISH', reasonCodes: [], conditions: { bullish, bearish, shared } };
  }

  // NO_TRADE: record exactly which conditions failed, per direction.
  if (!bullish.closeAboveVwap) reasonCodes.push(REASON.BULL_CLOSE_NOT_ABOVE_VWAP);
  if (!bullish.emaFastAboveSlow) reasonCodes.push(REASON.BULL_EMA_FAST_NOT_ABOVE_SLOW);
  if (!bullish.rsiInRange) reasonCodes.push(REASON.BULL_RSI_OUT_OF_RANGE);
  if (!bullish.volumeAboveAverage) reasonCodes.push(REASON.BULL_VOLUME_BELOW_AVERAGE);
  if (!bearish.closeBelowVwap) reasonCodes.push(REASON.BEAR_CLOSE_NOT_BELOW_VWAP);
  if (!bearish.emaFastBelowSlow) reasonCodes.push(REASON.BEAR_EMA_FAST_NOT_BELOW_SLOW);
  if (!bearish.rsiInRange) reasonCodes.push(REASON.BEAR_RSI_OUT_OF_RANGE);
  if (!bearish.volumeAboveAverage) reasonCodes.push(REASON.BEAR_VOLUME_BELOW_AVERAGE);

  return { direction: null, reasonCodes, conditions: { bullish, bearish, shared } };
}
