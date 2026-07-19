import mongoose from 'mongoose';
import { writeStructuredLog } from '../../../shared/logging/safeLogging';
import { DailyReportModel } from '../models/dailyReport.model';
import { DecisionJournalModel } from '../models/decisionJournal.model';
import {
  STRATEGY_ANALYTICS_WINDOW_TYPES,
  StrategyAnalyticsModel,
  type StrategyAnalyticsBucket,
  type StrategyAnalyticsDocument,
  type StrategyAnalyticsHydratedDocument,
  type StrategyAnalyticsWarning,
  type StrategyAnalyticsWindowType,
} from '../models/strategyAnalytics.model';
import { TradeReportModel } from '../models/tradeReport.model';
import { TradingSessionModel } from '../models/tradingSession.model';

const GENERATOR_VERSION = 'strategy-analytics-v1';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIMEZONE = 'America/New_York';
const NOTE_LIMIT = 5;
const SAMPLE_LIMIT = 5;

type GenerationResult = {
  analytics: StrategyAnalyticsHydratedDocument;
  idempotent: boolean;
};

type WindowDefinition = {
  tradingDate: string;
  windowType: StrategyAnalyticsWindowType;
  windowStartDate: string;
  windowEndDate: string;
  windowStart: Date;
  windowEnd: Date;
};

type TradeFact = {
  report: any;
  decision: any | null;
  tradeId: string;
  sessionId: string;
  dailyReportId: string | null;
  strategyKey: string;
  strategyLabel: string;
  strategySource: string | null;
  symbol: string;
  realizedPnl: number | null;
  openedAt: Date | null;
  closedAt: Date | null;
  confidence: number | null;
  dte: number | null;
  deltaAbs: number | null;
  ivPct: number | null;
  weekday: string;
  timeOfDay: string;
  sector: string | null;
  marketRegime: string | null;
  exitReason: string;
  riskProfile: string;
  riskProfileValue: number | null;
  riskProfileSource: string | null;
  decisionId: string | null;
};

type BucketState = {
  key: string;
  label: string;
  totalTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  netPnlSum: number;
  grossProfit: number;
  grossLoss: number;
  positiveSum: number;
  positiveCount: number;
  negativeSum: number;
  negativeCount: number;
  inputSum: number;
  inputCount: number;
  sampleTradeIds: string[];
  sampleReportIds: string[];
  sampleDecisionIds: string[];
  notes: string[];
};

function assertTradingDate(value: string): void {
  if (!DATE_RE.test(value)) {
    throw Object.assign(new Error('tradingDate must be YYYY-MM-DD'), { status: 400 });
  }
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

function zonedMidnightUtc(tradingDate: string, timezone = TIMEZONE): Date {
  const [year, month, day] = tradingDate.split('-').map(Number);
  const desired = Date.UTC(year, month - 1, day, 0, 0, 0);
  let guess = Date.UTC(year, month - 1, day, 5, 0, 0);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  for (let i = 0; i < 5; i += 1) {
    const parts: Record<string, number> = {};
    for (const part of formatter.formatToParts(new Date(guess))) {
      if (part.type !== 'literal') parts[part.type] = Number(part.value);
    }
    const actual = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const delta = actual - desired;
    if (delta === 0) break;
    guess -= delta;
  }
  return new Date(guess);
}

function formatNyDateKey(value: Date | string): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return parts.year && parts.month && parts.day ? `${parts.year}-${parts.month}-${parts.day}` : null;
}

function nyWeekday(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not captured';
  return new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, weekday: 'long' }).format(date);
}

function nyTimeOfDayBucket(value: Date | string | null | undefined): string {
  if (!value) return 'Not captured';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not captured';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const bucket: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') bucket[part.type] = part.value;
  }
  const hour = Number(bucket.hour);
  const minute = Number(bucket.minute);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return 'Not captured';
  const minutes = hour * 60 + minute;
  if (minutes < 10 * 60 + 30) return 'Pre-market';
  if (minutes < 11 * 60 + 30) return '09:30-11:29';
  if (minutes < 13 * 60) return '11:30-12:59';
  if (minutes < 15 * 60) return '13:00-14:59';
  if (minutes < 16 * 60) return '15:00-15:59';
  return 'After hours';
}

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function round(value: number | null, digits = 4): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function roundCurrency(value: number | null): number | null {
  return round(value, 2);
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function normalizePercentValue(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const absolute = Math.abs(value);
  return absolute <= 1 ? value * 100 : value;
}

function normalizeAbsDelta(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.abs(value);
}

function bucketNumeric(value: number | null, ranges: Array<{ max?: number; key: string; label: string }>): { key: string; label: string } {
  if (value == null || !Number.isFinite(value)) {
    return { key: 'not-captured', label: 'Not captured' };
  }
  for (const range of ranges) {
    if (range.max == null || value <= range.max) {
      return { key: range.key, label: range.label };
    }
  }
  return ranges[ranges.length - 1] ?? { key: 'not-captured', label: 'Not captured' };
}

function classifyStrategy(report: any): { key: string; label: string; source: string | null } {
  const rawValues = [report.identity?.strategy, report.identity?.strategyVersionId, report.signal?.candidateStatus].filter(
    (value): value is string => typeof value === 'string' && Boolean(value.trim())
  );
  const combined = rawValues.join(' ').toLowerCase();
  if (/(opening[\s_-]*range|orbd|openingrange)/.test(combined)) return { key: 'opening-range', label: 'Opening Range', source: rawValues[0] ?? null };
  if (/breakout/.test(combined)) return { key: 'breakout', label: 'Breakout', source: rawValues[0] ?? null };
  if (/(reversal|fade)/.test(combined)) return { key: 'reversal', label: 'Reversal', source: rawValues[0] ?? null };
  if (/flow/.test(combined)) return { key: 'flow', label: 'Flow', source: rawValues[0] ?? null };
  if (/momentum/.test(combined)) return { key: 'momentum', label: 'Momentum', source: rawValues[0] ?? null };
  return { key: 'other', label: 'Other', source: rawValues[0] ?? null };
}

function extractLabel(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const key of ['sector', 'sectorName', 'name', 'label', 'industry']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return null;
}

function exitReasonBucket(reason: string | null | undefined): { key: string; label: string } {
  if (!reason) return { key: 'not-captured', label: 'Not captured' };
  switch (reason) {
    case 'END_OF_DAY':
      return { key: 'end-of-day', label: 'END_OF_DAY' };
    case 'PROFIT_TARGET':
    case 'TARGET':
      return { key: 'target', label: 'TARGET' };
    case 'HARD_STOP':
    case 'EMERGENCY_STOP':
    case 'STOP':
      return { key: 'stop', label: 'STOP' };
    case 'ORDER_TIMEOUT':
    case 'TIMEOUT':
      return { key: 'timeout', label: 'TIMEOUT' };
    case 'OVERNIGHT_RECOVERY':
    case 'OVERNIGHT':
      return { key: 'overnight', label: 'OVERNIGHT' };
    case 'MANUAL_REVIEW':
    case 'MANUAL':
      return { key: 'manual', label: 'MANUAL' };
    default:
      return { key: 'other', label: reason };
  }
}

function dteBucket(value: number | null): { key: string; label: string } {
  return bucketNumeric(value, [
    { max: 1, key: '0-1', label: '0-1' },
    { max: 5, key: '2-5', label: '2-5' },
    { max: 10, key: '6-10', label: '6-10' },
    { max: 21, key: '11-21', label: '11-21' },
    { key: '22+', label: '22+' },
  ]);
}

function deltaBucket(value: number | null): { key: string; label: string } {
  return bucketNumeric(value, [
    { max: 0.2, key: '0.00-0.20', label: '0.00-0.20' },
    { max: 0.4, key: '0.20-0.40', label: '0.20-0.40' },
    { max: 0.6, key: '0.40-0.60', label: '0.40-0.60' },
    { key: '0.60+', label: '0.60+' },
  ]);
}

function percentBucket(value: number | null): { key: string; label: string } {
  return bucketNumeric(value, [
    { max: 59, key: 'below-60', label: 'Below 60' },
    { max: 69, key: '60-69', label: '60-69' },
    { max: 79, key: '70-79', label: '70-79' },
    { max: 89, key: '80-89', label: '80-89' },
    { key: '90-100', label: '90-100' },
  ]);
}

function ivBucket(value: number | null): { key: string; label: string } {
  return bucketNumeric(normalizePercentValue(value), [
    { max: 20, key: '0-20', label: '0-20%' },
    { max: 35, key: '20-35', label: '20-35%' },
    { max: 50, key: '35-50', label: '35-50%' },
    { key: '50+', label: '50%+' },
  ]);
}

function riskBucket(value: number | null): { key: string; label: string } {
  return bucketNumeric(value, [
    { max: 1, key: '1', label: '1 contract' },
    { max: 3, key: '2-3', label: '2-3 contracts' },
    { key: '4+', label: '4+ contracts' },
  ]);
}

function timeBucket(value: Date | null): { key: string; label: string } {
  if (!value) return { key: 'not-captured', label: 'Not captured' };
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(value);
  const bucket: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') bucket[part.type] = part.value;
  }
  const hour = Number(bucket.hour);
  const minute = Number(bucket.minute);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return { key: 'not-captured', label: 'Not captured' };
  const minuteOfDay = hour * 60 + minute;
  if (minuteOfDay < 10 * 60 + 30) return { key: 'pre-market', label: 'Pre-market' };
  if (minuteOfDay < 11 * 60 + 30) return { key: '09:30-11:29', label: '09:30-11:29' };
  if (minuteOfDay < 13 * 60) return { key: '11:30-12:59', label: '11:30-12:59' };
  if (minuteOfDay < 15 * 60) return { key: '13:00-14:59', label: '13:00-14:59' };
  if (minuteOfDay < 16 * 60) return { key: '15:00-15:59', label: '15:00-15:59' };
  return { key: 'after-hours', label: 'After hours' };
}

function createBucket(key: string, label: string): BucketState {
  return {
    key,
    label,
    totalTrades: 0,
    wins: 0,
    losses: 0,
    breakeven: 0,
    netPnlSum: 0,
    grossProfit: 0,
    grossLoss: 0,
    positiveSum: 0,
    positiveCount: 0,
    negativeSum: 0,
    negativeCount: 0,
    inputSum: 0,
    inputCount: 0,
    sampleTradeIds: [],
    sampleReportIds: [],
    sampleDecisionIds: [],
    notes: [],
  };
}

function bucketNotes(state: BucketState, note: string | null | undefined): void {
  if (!note) return;
  if (state.notes.includes(note)) return;
  if (state.notes.length < NOTE_LIMIT) state.notes.push(note);
}

function bucketSample(collection: string[], value: string | null | undefined): void {
  if (!value) return;
  if (collection.includes(value)) return;
  if (collection.length < SAMPLE_LIMIT) collection.push(value);
}

function ingestBucket(state: BucketState, trade: TradeFact, inputValue: number | null, note: string | null = null): void {
  state.totalTrades += 1;
  const pnl = trade.realizedPnl;
  if (pnl == null) {
    bucketNotes(state, 'Realized P/L was not captured for at least one trade in this bucket.');
  } else {
    state.netPnlSum += pnl;
    if (pnl > 0) {
      state.wins += 1;
      state.grossProfit += pnl;
      state.positiveSum += pnl;
      state.positiveCount += 1;
    } else if (pnl < 0) {
      state.losses += 1;
      state.grossLoss += Math.abs(pnl);
      state.negativeSum += pnl;
      state.negativeCount += 1;
    } else {
      state.breakeven += 1;
    }
  }
  if (inputValue != null && Number.isFinite(inputValue)) {
    state.inputSum += inputValue;
    state.inputCount += 1;
  }
  bucketSample(state.sampleTradeIds, trade.tradeId);
  bucketSample(state.sampleReportIds, trade.report.reportId);
  bucketSample(state.sampleDecisionIds, trade.decisionId);
  bucketNotes(state, note);
}

function finalizeBucket(state: BucketState): StrategyAnalyticsBucket {
  const totalTrades = state.totalTrades;
  const winRate = totalTrades ? state.wins / totalTrades : null;
  const expectancy = totalTrades ? state.netPnlSum / totalTrades : null;
  const profitFactor = state.grossLoss > 0 ? state.grossProfit / state.grossLoss : null;
  const averageWinner = state.positiveCount ? state.positiveSum / state.positiveCount : null;
  const averageLoser = state.negativeCount ? state.negativeSum / state.negativeCount : null;
  const averageInputValue = state.inputCount ? state.inputSum / state.inputCount : null;
  return {
    key: state.key,
    label: state.label,
    totalTrades,
    wins: state.wins,
    losses: state.losses,
    breakeven: state.breakeven,
    netPnl: totalTrades ? roundCurrency(state.netPnlSum) : null,
    winRate: winRate == null ? null : round(winRate, 4),
    expectancy: expectancy == null ? null : roundCurrency(expectancy),
    profitFactor: profitFactor == null ? null : round(profitFactor, 4),
    averageWinner: averageWinner == null ? null : roundCurrency(averageWinner),
    averageLoser: averageLoser == null ? null : roundCurrency(averageLoser),
    averageInputValue: averageInputValue == null ? null : round(averageInputValue, 4),
    sampleTradeIds: state.sampleTradeIds,
    sampleReportIds: state.sampleReportIds,
    sampleDecisionIds: state.sampleDecisionIds,
    notes: state.notes,
  };
}

function dedupe(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
    .filter(value => value.trim().length > 0)
    .sort();
}

function addWarning(warnings: StrategyAnalyticsWarning[], code: string, message: string, source: string | null = null): void {
  warnings.push({ code, message, source });
}

function buildWindowDefinition(windowType: StrategyAnalyticsWindowType, tradingDate: string): WindowDefinition {
  assertTradingDate(tradingDate);
  let windowStartDate = tradingDate;
  let windowEndDate = tradingDate;
  if (windowType === 'WEEKLY') {
    const weekday = new Date(`${tradingDate}T00:00:00Z`).getUTCDay();
    const offsetToMonday = (weekday + 6) % 7;
    windowStartDate = addDays(tradingDate, -offsetToMonday);
    windowEndDate = addDays(windowStartDate, 6);
  } else if (windowType === 'MONTHLY') {
    const [year, month] = tradingDate.split('-').map(Number);
    windowStartDate = `${tradingDate.slice(0, 7)}-01`;
    const nextMonth = new Date(Date.UTC(year, month, 1));
    windowEndDate = new Date(Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  } else if (windowType === 'ROLLING') {
    windowStartDate = addDays(tradingDate, -29);
    windowEndDate = tradingDate;
  }
  const windowStart = zonedMidnightUtc(windowStartDate);
  const windowEnd = zonedMidnightUtc(addDays(windowEndDate, 1));
  return { tradingDate, windowType, windowStartDate, windowEndDate, windowStart, windowEnd };
}

function analyticsId(windowType: StrategyAnalyticsWindowType, tradingDate: string, environment: string): string {
  return `analytics:${windowType.toLowerCase()}:${tradingDate}:${environment.toLowerCase()}`;
}

function choosePrimaryDecision(decisions: any[]): any | null {
  const preferredTypes = new Set(['BUY_APPROVED', 'SELL_APPROVED', 'RISK_REJECTED', 'BUY_REJECTED', 'SELL_REJECTED']);
  return (
    decisions.find(decision => preferredTypes.has(decision.decisionType)) ??
    decisions.find(decision => decision.decisionType === 'EXIT_TRIGGERED') ??
    decisions[0] ??
    null
  );
}

function buildTradeFacts(args: {
  tradeReports: any[];
  decisions: any[];
  dailyReportsBySession: Map<string, any>;
}): TradeFact[] {
  const decisionsByTrade = new Map<string, any[]>();
  for (const decision of args.decisions) {
    const key = decision.tradeId ? String(decision.tradeId) : null;
    if (!key) continue;
    const existing = decisionsByTrade.get(key);
    if (existing) existing.push(decision);
    else decisionsByTrade.set(key, [decision]);
  }

  return args.tradeReports.map(report => {
    const reportDecision = choosePrimaryDecision(decisionsByTrade.get(String(report.tradeId)) ?? []);
    const strategy = classifyStrategy(report);
    const openedAt = report.lifecycle?.openedAt ? new Date(report.lifecycle.openedAt) : null;
    const closedAt = report.lifecycle?.closedAt ? new Date(report.lifecycle.closedAt) : null;
    const openDate = openedAt ? formatNyDateKey(openedAt) : null;
    const expiration = typeof report.identity?.contractExpiration === 'string' ? report.identity.contractExpiration : null;
    const dte =
      openDate && expiration
        ? (() => {
            const [expirationYear, expirationMonth, expirationDay] = expiration.split('-').map(Number);
            const [openYear, openMonth, openDay] = openDate.split('-').map(Number);
            return Math.max(
              0,
              Math.round(
                (Date.UTC(expirationYear, expirationMonth - 1, expirationDay) - Date.UTC(openYear, openMonth - 1, openDay)) /
                  86_400_000
              )
            );
          })()
        : null;
    const deltaAbs = normalizeAbsDelta(toNumber(report.greeks?.delta));
    const ivPct = normalizePercentValue(toNumber(report.greeks?.iv));
    const confidence = normalizePercentValue(toNumber(report.signal?.confidence ?? reportDecision?.evaluation?.confidence));
    const weekday = openedAt ? nyWeekday(openedAt) : 'Not captured';
    const timeOfDay = timeBucket(openedAt).label;
    const sector = extractLabel(report.marketContext?.sectorContext);
    const marketRegimeSource =
      (typeof report.marketContext?.marketRegime === 'string' && report.marketContext.marketRegime.trim())
        ? report.marketContext.marketRegime.trim()
        : typeof reportDecision?.evaluation?.marketRegime === 'string' && reportDecision.evaluation.marketRegime.trim()
          ? reportDecision.evaluation.marketRegime.trim()
          : null;
    const exit = exitReasonBucket(report.lifecycle?.exitReason ?? null);
    const riskProfileValue = toNumber(reportDecision?.riskSnapshot?.positionSize ?? null);
    const riskProfile = riskBucket(riskProfileValue).label;

    return {
      report,
      decision: reportDecision,
      tradeId: String(report.tradeId),
      sessionId: String(report.sessionId),
      dailyReportId: args.dailyReportsBySession.get(String(report.sessionId))?.reportId ?? null,
      strategyKey: strategy.key,
      strategyLabel: strategy.label,
      strategySource: strategy.source,
      symbol: String(report.identity?.underlying ?? 'Not captured'),
      realizedPnl: toNumber(report.performance?.realizedPnl),
      openedAt,
      closedAt,
      confidence,
      dte,
      deltaAbs,
      ivPct,
      weekday,
      timeOfDay,
      sector,
      marketRegime: marketRegimeSource,
      exitReason: exit.label,
      riskProfile,
      riskProfileValue,
      riskProfileSource: reportDecision?.riskSnapshot?.positionSize != null ? 'DecisionJournal.riskSnapshot.positionSize' : null,
      decisionId: reportDecision ? String(reportDecision.decisionId) : null,
    };
  });
}

function mapCounts(trades: TradeFact[]): {
  totalTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  netPnl: number | null;
  winRate: number | null;
  expectancy: number | null;
  profitFactor: number | null;
  averageWinner: number | null;
  averageLoser: number | null;
  drawdown: number | null;
  capitalEfficiency: number | null;
} {
  const realized = trades.map(trade => trade.realizedPnl).filter((value): value is number => value != null);
  const wins = realized.filter(value => value > 0);
  const losses = realized.filter(value => value < 0);
  const breakeven = realized.filter(value => value === 0).length;
  const netPnl = realized.length ? roundCurrency(sum(realized)) : null;
  const profitFactor = losses.length ? sum(wins) / Math.abs(sum(losses)) : wins.length ? null : null;
  const averageWinner = wins.length ? average(wins) : null;
  const averageLoser = losses.length ? average(losses) : null;
  return {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    breakeven,
    netPnl,
    winRate: trades.length ? round(wins.length / trades.length, 4) : null,
    expectancy: trades.length && netPnl != null ? roundCurrency(netPnl / trades.length) : null,
    profitFactor: profitFactor == null || Number.isNaN(profitFactor) ? null : round(profitFactor, 4),
    averageWinner: averageWinner == null ? null : roundCurrency(averageWinner),
    averageLoser: averageLoser == null ? null : roundCurrency(averageLoser),
    drawdown: null,
    capitalEfficiency: null,
  };
}

function buildBucketedSection(
  trades: TradeFact[],
  keySelector: (trade: TradeFact) => { key: string; label: string },
  inputSelector: (trade: TradeFact) => number | null,
  noteSelector: ((trade: TradeFact) => string | null) | null = null
): StrategyAnalyticsBucket[] {
  const buckets = new Map<string, BucketState>();
  for (const trade of trades) {
    const bucketInfo = keySelector(trade);
    const state = buckets.get(bucketInfo.key) ?? createBucket(bucketInfo.key, bucketInfo.label);
    ingestBucket(state, trade, inputSelector(trade), noteSelector?.(trade) ?? null);
    buckets.set(bucketInfo.key, state);
  }
  return [...buckets.values()].sort((a, b) => b.netPnlSum - a.netPnlSum || a.label.localeCompare(b.label)).map(finalizeBucket);
}

function buildEvidenceQuality(
  sessions: any[],
  dailyReports: any[],
  tradeReports: any[],
  decisions: any[],
  trades: TradeFact[]
): { availableEvidencePercent: number; missingEvidence: string[]; warnings: StrategyAnalyticsWarning[] } {
  const warnings: StrategyAnalyticsWarning[] = [];
  const missingEvidence = new Set<string>();
  const checks: boolean[] = [];

  checks.push(sessions.length > 0);
  if (!sessions.length) missingEvidence.add('trading sessions');

  const expectedClosedTrades = sessions.reduce((total, session) => total + (toNumber(session.tradeSummary?.tradesClosed) ?? 0), 0);
  checks.push(tradeReports.length === expectedClosedTrades);
  if (tradeReports.length !== expectedClosedTrades) {
    missingEvidence.add('closed trade reports');
    addWarning(
      warnings,
      'TRADE_REPORT_COUNT_MISMATCH',
      `Window expected ${expectedClosedTrades} closed trade report(s), but ${tradeReports.length} were found.`,
      'TradeReport'
    );
  }

  checks.push(dailyReports.length === sessions.length);
  if (dailyReports.length !== sessions.length) {
    missingEvidence.add('daily reports');
    addWarning(
      warnings,
      'DAILY_REPORT_COUNT_MISMATCH',
      `Window expected ${sessions.length} daily report(s), but ${dailyReports.length} were found.`,
      'DailyReport'
    );
  }

  checks.push(decisions.length > 0);
  if (!decisions.length) missingEvidence.add('decision journal entries');

  const hasStrategy = trades.some(trade => trade.strategyKey !== 'other' || trade.strategyLabel !== 'Other');
  checks.push(hasStrategy || trades.length === 0);
  if (!hasStrategy && trades.length > 0) missingEvidence.add('strategy attribution');

  const hasConfidence = trades.some(trade => trade.confidence != null);
  checks.push(hasConfidence || trades.length === 0);
  if (!hasConfidence && trades.length > 0) missingEvidence.add('confidence evidence');

  const hasDte = trades.some(trade => trade.dte != null);
  checks.push(hasDte || trades.length === 0);
  if (!hasDte && trades.length > 0) missingEvidence.add('dte evidence');

  const hasDelta = trades.some(trade => trade.deltaAbs != null);
  checks.push(hasDelta || trades.length === 0);
  if (!hasDelta && trades.length > 0) missingEvidence.add('delta evidence');

  const hasIv = trades.some(trade => trade.ivPct != null);
  checks.push(hasIv || trades.length === 0);
  if (!hasIv && trades.length > 0) missingEvidence.add('iv evidence');

  const hasRegime = trades.some(trade => trade.marketRegime != null);
  checks.push(hasRegime || trades.length === 0);
  if (!hasRegime && trades.length > 0) missingEvidence.add('market regime evidence');

  const hasSector = trades.some(trade => trade.sector != null);
  checks.push(hasSector || trades.length === 0);
  if (!hasSector && trades.length > 0) missingEvidence.add('sector evidence');

  const hasRiskProfile = trades.some(trade => trade.riskProfileValue != null);
  checks.push(hasRiskProfile || trades.length === 0);
  if (!hasRiskProfile && trades.length > 0) missingEvidence.add('risk profile evidence');

  const hasExitReason = trades.some(trade => trade.exitReason !== 'Not captured');
  checks.push(hasExitReason || trades.length === 0);
  if (!hasExitReason && trades.length > 0) missingEvidence.add('exit reason evidence');

  const available = checks.length ? checks.filter(Boolean).length / checks.length : 0;
  if (!sessions.length) {
    addWarning(warnings, 'NO_TRADING_SESSIONS', 'No trading sessions were captured for the requested window.', 'TradingSession');
  }
  if (!tradeReports.length && sessions.length) {
    addWarning(warnings, 'NO_TRADE_REPORTS', 'No trade reports were captured for the requested window.', 'TradeReport');
  }
  if (!decisions.length && sessions.length) {
    addWarning(warnings, 'NO_DECISION_JOURNAL', 'No decision journal entries were captured for the requested window.', 'DecisionJournal');
  }
  if (!hasSector && trades.length) {
    addWarning(warnings, 'SECTOR_CONTEXT_NOT_CAPTURED', 'Sector attribution is not persisted in the current evidence window.', 'TradeReport');
  }
  if (!hasRegime && trades.length) {
    addWarning(warnings, 'MARKET_REGIME_NOT_CAPTURED', 'Market regime attribution is not persisted in the current evidence window.', 'TradeReport');
  }
  if (!hasRiskProfile && trades.length) {
    addWarning(warnings, 'RISK_PROFILE_NOT_CAPTURED', 'Risk-profile values were not captured in the current evidence window.', 'DecisionJournal');
  }
  if (!hasDte && trades.length) {
    addWarning(warnings, 'DTE_NOT_CAPTURED', 'DTE attribution is unavailable for at least one trade in this window.', 'TradeReport');
  }
  if (!hasConfidence && trades.length) {
    addWarning(warnings, 'CONFIDENCE_NOT_CAPTURED', 'Confidence values are unavailable for at least one trade in this window.', 'TradeReport');
  }

  return {
    availableEvidencePercent: Math.round(available * 100),
    missingEvidence: [...missingEvidence].sort(),
    warnings,
  };
}

function buildStrategyAnalyticsDocument(args: {
  window: WindowDefinition;
  sessions: any[];
  dailyReports: any[];
  tradeReports: any[];
  decisions: any[];
}): Omit<StrategyAnalyticsDocument, '_id' | 'createdAt' | 'updatedAt'> {
  const sessionIds = dedupe(args.sessions.map(session => session.sessionId));
  const dailyReportsBySession = new Map(args.dailyReports.map(report => [String(report.sessionId), report]));
  const trades = buildTradeFacts({
    tradeReports: args.tradeReports,
    decisions: args.decisions,
    dailyReportsBySession,
  });
  const performance = mapCounts(trades);
  const buyingPower = args.dailyReports
    .map(report => toNumber(report.capital?.buyingPower))
    .filter((value): value is number => value != null);
  const drawdownValues = args.dailyReports
    .map(report => toNumber(report.capital?.drawdown))
    .filter((value): value is number => value != null);
  const dailyCapitalEfficiency = args.dailyReports
    .map(report => toNumber(report.capital?.capitalEfficiency))
    .filter((value): value is number => value != null);

  performance.drawdown = drawdownValues.length ? Math.min(...drawdownValues) : null;
  performance.capitalEfficiency =
    dailyCapitalEfficiency.length
      ? round(average(dailyCapitalEfficiency), 4)
      : buyingPower.length && performance.netPnl != null && (average(buyingPower) ?? 0) !== 0
        ? round(performance.netPnl / average(buyingPower)!, 4)
        : null;

  const strategyBreakdown = buildBucketedSection(
    trades,
    trade => trade.strategyKey === 'other' ? { key: 'other', label: trade.strategyLabel } : { key: trade.strategyKey, label: trade.strategyLabel },
    () => null,
    trade => trade.strategySource
  );
  const underlyingBreakdown = buildBucketedSection(trades, trade => ({ key: trade.symbol, label: trade.symbol }), () => null);
  const sectorBreakdown = buildBucketedSection(
    trades,
    trade => ({ key: trade.sector ?? 'not-captured', label: trade.sector ?? 'Not captured' }),
    () => null,
    trade => trade.sector
  );
  const marketRegimeBreakdown = buildBucketedSection(
    trades,
    trade => ({ key: trade.marketRegime ?? 'not-captured', label: trade.marketRegime ?? 'Not captured' }),
    () => null,
    trade => trade.marketRegime
  );
  const confidenceBreakdown = buildBucketedSection(
    trades,
    trade => percentBucket(trade.confidence),
    trade => trade.confidence,
    trade => (trade.confidence != null ? `Trade confidence ${trade.confidence.toFixed(2)}` : null)
  );
  const dteBreakdown = buildBucketedSection(trades, trade => dteBucket(trade.dte), trade => trade.dte);
  const deltaBreakdown = buildBucketedSection(
    trades,
    trade => deltaBucket(trade.deltaAbs),
    trade => trade.deltaAbs
  );
  const ivBreakdown = buildBucketedSection(trades, trade => ivBucket(trade.ivPct), trade => trade.ivPct);
  const weekdayBreakdown = buildBucketedSection(
    trades,
    trade => ({ key: trade.weekday.toLowerCase().replace(/\s+/g, '-'), label: trade.weekday }),
    () => null,
    trade => trade.weekday === 'Not captured' ? null : trade.weekday
  );
  const timeOfDayBreakdown = buildBucketedSection(
    trades,
    trade => ({ key: trade.timeOfDay.toLowerCase().replace(/\s+/g, '-'), label: trade.timeOfDay }),
    () => null,
    trade => trade.timeOfDay === 'Not captured' ? null : trade.timeOfDay
  );
  const exitReasonBreakdown = buildBucketedSection(
    trades,
    trade => exitReasonBucket(trade.exitReason),
    () => null,
    trade => trade.exitReason === 'Not captured' ? null : trade.exitReason
  );
  const riskProfileBreakdown = buildBucketedSection(
    trades,
    trade => riskBucket(trade.riskProfileValue),
    trade => trade.riskProfileValue,
    trade => trade.riskProfileSource
  );

  const evidenceQuality = buildEvidenceQuality(args.sessions, args.dailyReports, args.tradeReports, args.decisions, trades);
  const warnings = [...evidenceQuality.warnings];

  const environment = (args.sessions.find(session => session.environment === 'LIVE')?.environment ?? args.sessions[0]?.environment ?? 'PAPER') as
    | 'PAPER'
    | 'LIVE';
  const generatedAt = new Date();

  return {
    analyticsId: analyticsId(args.window.windowType, args.window.tradingDate, environment),
    tradingDate: args.window.tradingDate,
    windowType: args.window.windowType,
    windowStart: args.window.windowStart,
    windowEnd: args.window.windowEnd,
    generatedAt,
    environment,
    status: 'GENERATED',
    performance,
    strategyBreakdown,
    underlyingBreakdown,
    sectorBreakdown,
    marketRegimeBreakdown,
    confidenceBreakdown,
    dteBreakdown,
    deltaBreakdown,
    ivBreakdown,
    weekdayBreakdown,
    timeOfDayBreakdown,
    exitReasonBreakdown,
    riskProfileBreakdown,
    evidenceQuality: {
      availableEvidencePercent: evidenceQuality.availableEvidencePercent,
      missingEvidence: evidenceQuality.missingEvidence,
    },
    warnings,
    references: {
      sessionIds,
      dailyReportIds: dedupe(args.dailyReports.map(report => report.reportId)),
      tradeReportIds: dedupe(args.tradeReports.map(report => report.reportId)),
      decisionJournalIds: dedupe(args.decisions.map(decision => decision.decisionId)),
    },
    generation: {
      schemaVersion: 1,
      generatorVersion: GENERATOR_VERSION,
      generatedBy: 'server:intelligence:strategy-analytics',
      generatedFromPersistedEvidence: true,
    },
  };
}

async function loadWindowEvidence(window: WindowDefinition) {
  const sessions = await TradingSessionModel.find({
    tradingDate: { $gte: window.windowStartDate, $lte: window.windowEndDate },
  })
    .sort({ tradingDate: 1, updatedAt: 1 })
    .lean();
  const sessionIds = sessions.map(session => session.sessionId);
  if (!sessionIds.length) {
    return { sessions, dailyReports: [], tradeReports: [], decisions: [] };
  }
  const [dailyReports, tradeReports, decisions] = await Promise.all([
    DailyReportModel.find({ sessionId: { $in: sessionIds } }).sort({ tradingDate: 1, updatedAt: 1 }).lean(),
    TradeReportModel.find({ sessionId: { $in: sessionIds } }).sort({ tradingDate: 1, 'lifecycle.closedAt': 1, updatedAt: 1 }).lean(),
    DecisionJournalModel.find({ sessionId: { $in: sessionIds } }).sort({ timestamp: 1 }).lean(),
  ]);
  return { sessions, dailyReports, tradeReports, decisions };
}

async function generateStrategyAnalyticsSnapshot(windowType: StrategyAnalyticsWindowType, tradingDate: string): Promise<GenerationResult> {
  assertTradingDate(tradingDate);
  const window = buildWindowDefinition(windowType, tradingDate);
  const evidence = await loadWindowEvidence(window);
  const doc = buildStrategyAnalyticsDocument({ window, ...evidence });
  const existing = await StrategyAnalyticsModel.findOne({
    windowType,
    tradingDate,
    environment: doc.environment,
  }).sort({ generatedAt: -1 });
  if (existing) return { analytics: existing, idempotent: true };

  try {
    const analytics = await StrategyAnalyticsModel.create(doc);
    writeStructuredLog({
      component: 'intelligence',
      module: 'strategy-analytics',
      event: 'STRATEGY_ANALYTICS_GENERATED',
      severity: 'info',
      context: {
        analyticsId: analytics.analyticsId,
        tradingDate: analytics.tradingDate,
        windowType: analytics.windowType,
        totalTrades: analytics.performance.totalTrades,
        netPnl: analytics.performance.netPnl,
      },
    });
    return { analytics, idempotent: false };
  } catch (error: any) {
    if (error?.code === 11000) {
      const raced = await StrategyAnalyticsModel.findOne({
        windowType,
        tradingDate,
        environment: doc.environment,
      }).sort({ generatedAt: -1 });
      if (raced) return { analytics: raced, idempotent: true };
    }
    throw error;
  }
}

export async function generateStrategyAnalyticsForDate(
  tradingDate: string,
  windowType: StrategyAnalyticsWindowType = 'DAILY'
): Promise<GenerationResult> {
  return generateStrategyAnalyticsSnapshot(windowType, tradingDate);
}

export async function backfillStrategyAnalyticsForDate(tradingDate: string): Promise<GenerationResult[]> {
  assertTradingDate(tradingDate);
  const results: GenerationResult[] = [];
  for (const windowType of STRATEGY_ANALYTICS_WINDOW_TYPES) {
    results.push(await generateStrategyAnalyticsSnapshot(windowType, tradingDate));
  }
  return results;
}

export async function listStrategyAnalytics(limit = 50): Promise<StrategyAnalyticsHydratedDocument[]> {
  return StrategyAnalyticsModel.find()
    .sort({ generatedAt: -1, windowEnd: -1, updatedAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 200));
}

export async function getLatestStrategyAnalytics(): Promise<StrategyAnalyticsHydratedDocument | null> {
  return StrategyAnalyticsModel.findOne().sort({ generatedAt: -1, windowEnd: -1, updatedAt: -1 });
}

export async function getStrategyAnalyticsByWindowType(
  windowType: StrategyAnalyticsWindowType,
  limit = 50
): Promise<StrategyAnalyticsHydratedDocument[]> {
  return StrategyAnalyticsModel.find({ windowType })
    .sort({ generatedAt: -1, windowEnd: -1, updatedAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 200));
}

export async function getStrategyAnalyticsByDate(tradingDate: string): Promise<StrategyAnalyticsHydratedDocument[]> {
  assertTradingDate(tradingDate);
  return StrategyAnalyticsModel.find({ tradingDate }).sort({ windowType: 1, generatedAt: -1 });
}

export async function getStrategyAnalyticsById(id: string): Promise<StrategyAnalyticsHydratedDocument | null> {
  const byAnalyticsId = await StrategyAnalyticsModel.findOne({ analyticsId: id });
  if (byAnalyticsId) return byAnalyticsId;
  if (mongoose.isValidObjectId(id)) {
    return StrategyAnalyticsModel.findById(id);
  }
  return null;
}

export async function generateStrategyAnalyticsForWindowType(
  windowType: StrategyAnalyticsWindowType,
  tradingDate: string
): Promise<GenerationResult> {
  return generateStrategyAnalyticsSnapshot(windowType, tradingDate);
}

export function validateWindowType(value: string): StrategyAnalyticsWindowType {
  if (!STRATEGY_ANALYTICS_WINDOW_TYPES.includes(value as StrategyAnalyticsWindowType)) {
    throw Object.assign(new Error('windowType must be DAILY, WEEKLY, MONTHLY, or ROLLING'), { status: 400 });
  }
  return value as StrategyAnalyticsWindowType;
}
