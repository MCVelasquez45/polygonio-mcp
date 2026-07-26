import mongoose from 'mongoose';
import { AutomationPositionModel } from '../../automation/models/automationPosition.model';
import { AutomationSessionModel } from '../../automation/models/automationSession.model';
import { SECTOR_BY_SYMBOL } from '../../eventIntelligence/classification/classifier.service';
import { underlyingFromOptionSymbol } from '../../../shared/symbols/optionSymbol';
import { getRiskRuleSet } from '../limits/riskRules.service';
import { aggregateGreeks, normalizeGreeks } from '../greeks/greeks.service';
import type { RiskExposureSnapshot, RiskPortfolioSnapshot } from '../types/riskTypes';

function finite(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cleanSymbol(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function add(map: Record<string, number>, key: string | null | undefined, value: number): void {
  const resolved = key || 'Unknown';
  map[resolved] = Number(((map[resolved] ?? 0) + Math.abs(value)).toFixed(2));
}

function buildRecommendedExposure(exposure: Record<string, number>, maxPct: number, portfolioSize: number): Record<string, number> {
  const max = Number((portfolioSize * maxPct).toFixed(2));
  const out: Record<string, number> = {};
  for (const sector of Object.keys(exposure)) out[sector] = max;
  return out;
}

export async function buildRiskPortfolioSnapshot(now = new Date()): Promise<RiskPortfolioSnapshot> {
  const rules = getRiskRuleSet(now);
  if (mongoose.connection?.readyState !== 1) {
    const exposure: RiskExposureSnapshot = {
      sectorExposure: {},
      tickerExposure: {},
      strategyExposure: {},
      macroExposure: {},
      longExposure: 0,
      shortExposure: 0,
      cashAllocation: null,
      maximumConcurrentTrades: rules.maximumOpenTrades,
      currentOpenTrades: 0,
      historicalMaximum: {},
      recommended: {},
    };
    return {
      timestamp: now.toISOString(),
      portfolioSize: rules.defaultPortfolioSize,
      buyingPower: null,
      availableCapital: null,
      currentPositions: [],
      exposure,
      greeks: { delta: null, gamma: null, theta: null, vega: null, rho: null },
      riskBudget: {
        dailyRealizedLoss: 0,
        dailyUnrealizedLoss: 0,
        riskConsumed: 0,
        remainingRiskBudget: rules.maximumDailyLoss,
        maximumConsecutiveLosses: 3,
        consecutiveLosses: 0,
        maximumOpenRisk: rules.maximumDollarRisk * rules.maximumOpenTrades,
        openRisk: 0,
      },
    };
  }

  const [positions, session] = await Promise.all([
    AutomationPositionModel.find({ status: { $in: ['PENDING_ENTRY', 'OPEN', 'EXITING', 'MANUAL_REVIEW'] } })
      .sort({ updatedAt: -1 })
      .limit(200)
      .lean(),
    AutomationSessionModel.findOne({ status: { $in: ['READY', 'PAUSED', 'EMERGENCY_STOPPED'] } })
      .sort({ updatedAt: -1 })
      .lean()
      .catch(() => null),
  ]);

  const currentPositions = positions.map((position: any) => {
    const optionSymbol = cleanSymbol(position.optionSymbol ?? position.symbol);
    const underlying = cleanSymbol(position.underlying) || underlyingFromOptionSymbol(optionSymbol) || null;
    const marketValue = finite(position.currentValue ?? position.marketValue ?? position.avgEntryPrice * position.filledQty * 100);
    return {
      symbol: optionSymbol,
      underlying,
      sector: underlying ? SECTOR_BY_SYMBOL[underlying] ?? null : null,
      strategyId: typeof position.strategyVersionId === 'string' ? position.strategyVersionId : null,
      direction: position.direction === 'BEARISH' ? ('SHORT' as const) : position.direction === 'BULLISH' ? ('LONG' as const) : ('UNKNOWN' as const),
      quantity: finite(position.filledQty ?? position.orderedQuantity),
      marketValue,
      unrealizedPnl: finite(position.unrealizedPnl),
      greeks: normalizeGreeks(position.greeks),
    };
  });

  const exposure: RiskExposureSnapshot = {
    sectorExposure: {},
    tickerExposure: {},
    strategyExposure: {},
    macroExposure: {},
    longExposure: 0,
    shortExposure: 0,
    cashAllocation: null,
    maximumConcurrentTrades: rules.maximumOpenTrades,
    currentOpenTrades: currentPositions.length,
    historicalMaximum: {},
    recommended: {},
  };

  for (const position of currentPositions) {
    add(exposure.sectorExposure, position.sector, position.marketValue);
    add(exposure.tickerExposure, position.underlying ?? position.symbol, position.marketValue);
    add(exposure.strategyExposure, position.strategyId, position.marketValue);
    if (position.sector && ['Energy', 'Financial', 'Technology'].includes(position.sector)) {
      add(exposure.macroExposure, position.sector, position.marketValue);
    }
    if (position.direction === 'SHORT') exposure.shortExposure += Math.abs(position.marketValue);
    else exposure.longExposure += Math.abs(position.marketValue);
  }

  const openRisk = Number(currentPositions.reduce((sum, position) => sum + Math.abs(position.marketValue), 0).toFixed(2));
  const dailyRealizedLoss = Math.max(0, -finite(session?.dailyRealizedPnl));
  const dailyUnrealizedLoss = Math.max(0, -currentPositions.reduce((sum, position) => sum + position.unrealizedPnl, 0));
  const riskConsumed = Number((dailyRealizedLoss + dailyUnrealizedLoss).toFixed(2));
  const portfolioSize = finite(session?.startingDayEquity ?? session?.peakEquity, rules.defaultPortfolioSize);
  exposure.cashAllocation = null;
  exposure.recommended = buildRecommendedExposure(exposure.sectorExposure, rules.maximumSectorExposurePct, portfolioSize);
  exposure.historicalMaximum = { ...exposure.sectorExposure };

  return {
    timestamp: now.toISOString(),
    portfolioSize,
    buyingPower: null,
    availableCapital: null,
    currentPositions,
    exposure,
    greeks: aggregateGreeks(currentPositions),
    riskBudget: {
      dailyRealizedLoss,
      dailyUnrealizedLoss,
      riskConsumed,
      remainingRiskBudget: Number(Math.max(0, rules.maximumDailyLoss - riskConsumed).toFixed(2)),
      maximumConsecutiveLosses: 3,
      consecutiveLosses: finite(session?.consecutiveLossCount),
      maximumOpenRisk: rules.maximumDollarRisk * rules.maximumOpenTrades,
      openRisk,
    },
  };
}

export function sectorExposureRatio(snapshot: RiskPortfolioSnapshot, sector: string | null, addedRisk = 0): number {
  const current = sector ? snapshot.exposure.sectorExposure[sector] ?? 0 : 0;
  return snapshot.portfolioSize > 0 ? (current + addedRisk) / snapshot.portfolioSize : 0;
}
