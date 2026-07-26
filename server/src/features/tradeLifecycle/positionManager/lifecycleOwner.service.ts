import mongoose from 'mongoose';
import { AutomationPositionModel } from '../../automation/models/automationPosition.model';
import { OrderIntentModel } from '../../automation/models/orderIntent.model';
import { RiskDecisionModel } from '../../automation/models/riskDecision.model';
import { TradeCandidateModel } from '../../automation/models/tradeCandidate.model';
import { UniverseEvaluationModel } from '../../automation/models/universeEvaluation.model';
import { AutomationEventModel } from '../../automation/models/automationEvent.model';
import { getMonitorStatus } from '../../automation/services/monitorController.service';
import { getSchedulerStatus } from '../../automation/services/schedulerController.service';
import { getAutomationHealth } from '../../automation/services/automationHealth.service';
import { generateTradeReportForTrade, getTradeReportById } from '../../intelligence/services/tradeReportGenerator.service';
import { expirationFromOptionSymbol } from '../../../shared/symbols/optionSymbol';
import { computeDteEt } from '../../../shared/time/tradingCalendar';
import { TradeLifecycleModel, type TradeLifecycleDocument } from '../storage/tradeLifecycle.model';
import { appendLifecycleJournal, listLifecycleJournal } from '../journal/lifecycleJournal.service';
import { extractEntryConfidence } from '../monitor/confidence.service';
import { evaluateLifecycleMonitoring } from '../monitor/lifecycleMonitor.service';
import { getTradeLifecycleFlags, getTradeLifecycleScheduleMs } from '../types/config';
import type {
  LifecycleEvaluationInput,
  LifecycleMonitoringDecision,
  TradeLifecycleState,
} from '../types/lifecycleTypes';
import {
  compareLifecycleStates,
  nextLifecycleStates,
  targetStateFromAutomationPosition,
} from './stateMachine.service';

function finite(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function iso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value;
  }
  if (typeof (value as any)?.toISOString === 'function') return (value as any).toISOString();
  return null;
}

function minutesBetween(start: unknown, end: Date): number | null {
  const started = Date.parse(iso(start) ?? '');
  if (!Number.isFinite(started)) return null;
  return Math.max(0, Math.round((end.getTime() - started) / 60_000));
}

function deriveReturnPct(position: any): number | null {
  const pnl = finite(position.unrealizedPnl) ?? finite(position.realizedPnl);
  const entry = finite(position.avgEntryPrice);
  const qty = finite(position.filledQty) ?? finite(position.orderedQuantity);
  const cost = entry != null && qty != null ? Math.abs(entry * qty * 100) : null;
  if (pnl == null || !cost) return finite(position.returnPct);
  return (pnl / cost) * 100;
}

async function upsertLifecycleRecord(position: any, candidate: any | null): Promise<TradeLifecycleDocument> {
  const tradeId = String(position._id);
  const existing = await TradeLifecycleModel.findOne({ tradeId });
  if (existing) {
    existing.automationPositionId = tradeId;
    existing.automationSessionId = position.automationSessionId ?? existing.automationSessionId;
    existing.strategyVersionId = position.strategyVersionId ?? existing.strategyVersionId;
    existing.underlying = position.underlying;
    existing.optionSymbol = position.optionSymbol;
    existing.entryIntentId = position.entryIntentId ?? existing.entryIntentId;
    existing.exitIntentId = position.exitIntentId ?? existing.exitIntentId;
    existing.riskDecisionId = position.riskDecisionId ?? existing.riskDecisionId;
    existing.recommendationId = position.universeEvaluationId ?? existing.recommendationId;
    return existing;
  }

  const entryConfidence = extractEntryConfidence(candidate);
  const created = await TradeLifecycleModel.create({
    tradeId,
    automationPositionId: tradeId,
    automationSessionId: position.automationSessionId ?? null,
    strategyVersionId: position.strategyVersionId ?? null,
    underlying: position.underlying,
    optionSymbol: position.optionSymbol,
    state: 'NEW',
    previousState: null,
    entryIntentId: position.entryIntentId ?? null,
    exitIntentId: position.exitIntentId ?? null,
    riskDecisionId: position.riskDecisionId ?? null,
    recommendationId: position.universeEvaluationId ?? null,
    confidence: {
      entry: entryConfidence,
      current: entryConfidence,
      trend: 'Unknown',
      delta: 0,
      changedAt: new Date(),
    },
    currentAction: 'NO_ACTION',
    reasoning: ['Lifecycle record created for automation-approved paper trade.'],
  });
  await appendLifecycleJournal({
    tradeId,
    eventType: 'LIFECYCLE_CREATED',
    state: 'NEW',
    previousState: null,
    source: 'trade-lifecycle',
    reason: 'Created lifecycle ownership record from existing automation position.',
    confidence: created.confidence,
    payload: { automationPositionId: tradeId, entryIntentId: created.entryIntentId },
  });
  return created;
}

async function advanceLifecycle(
  lifecycle: TradeLifecycleDocument,
  target: TradeLifecycleState,
  payload: Record<string, unknown>
): Promise<void> {
  if (compareLifecycleStates(lifecycle.state, target) >= 0) return;
  for (const next of nextLifecycleStates(lifecycle.state, target)) {
    const previous = lifecycle.state;
    lifecycle.previousState = previous;
    lifecycle.state = next;
    if (next === 'ARCHIVED') lifecycle.archivedAt = lifecycle.archivedAt ?? new Date();
    await lifecycle.save();
    await appendLifecycleJournal({
      tradeId: lifecycle.tradeId,
      eventType: 'STATE_TRANSITION',
      state: next,
      previousState: previous,
      source: 'trade-lifecycle',
      reason: `Advanced lifecycle from ${previous} to ${next}.`,
      confidence: lifecycle.confidence,
      payload,
    });
  }
}

function buildEvaluationInput(args: {
  lifecycle: TradeLifecycleDocument;
  position: any;
  candidate: any | null;
  evaluation: any | null;
  risk: any | null;
  now: Date;
}): LifecycleEvaluationInput {
  const { lifecycle, position, candidate, evaluation, risk, now } = args;
  const returnPct = deriveReturnPct(position);
  const spreadPct =
    finite((evaluation?.ranking ?? []).find((item: any) => item?.contractSymbol === position.optionSymbol)?.spreadPct) ??
    null;
  const conditions = candidate?.conditions ?? {};
  const originalThesis = [candidate?.signalDirection, conditions.trend, conditions.regime].filter(Boolean).join(' ') || null;
  const updatedThesis = originalThesis;
  const marketRegime = String(evaluation?.marketClockDecision?.state ?? conditions.regime ?? '') || null;
  const riskChanged = Boolean(risk?.approved === false || (risk?.reasonCodes ?? []).length > 0);
  return {
    tradeId: lifecycle.tradeId,
    symbol: position.optionSymbol,
    state: lifecycle.state,
    entryConfidence: lifecycle.confidence.entry,
    currentConfidence: lifecycle.confidence.current,
    currentProfit: Math.max(0, finite(position.unrealizedPnl) ?? finite(position.realizedPnl) ?? 0),
    currentLoss: Math.min(0, finite(position.unrealizedPnl) ?? finite(position.realizedPnl) ?? 0),
    returnPct,
    spreadPct,
    liquidityScore: null,
    daysToExpiration: computeDteEt(expirationFromOptionSymbol(position.optionSymbol), now.getTime()),
    timeHeldMinutes: minutesBetween(position.openedAt ?? position.createdAt, now),
    eventRisk: null,
    originalThesis,
    updatedThesis,
    strategyChanged: false,
    riskChanged,
    marketRegime,
    volatility: finite(conditions.volatility),
  };
}

async function maybeRunEvaluation(lifecycle: TradeLifecycleDocument, position: any): Promise<void> {
  if (position.status !== 'CLOSED') return;
  if (lifecycle.evaluationReportId) return;
  try {
    const result = await generateTradeReportForTrade(String(position._id));
    const report: any = result.report;
    lifecycle.evaluationReportId = result.report.reportId;
    lifecycle.evaluationSummary = {
      reportId: report.reportId,
      idempotent: result.idempotent,
      winLoss:
        Number(report.performance?.realizedPnl ?? 0) > 0
          ? 'WIN'
          : Number(report.performance?.realizedPnl ?? 0) < 0
            ? 'LOSS'
            : 'FLAT',
      return: report.performance?.returnPct ?? null,
      maximumFavorableExcursion: report.performance?.maxFavorableExcursion ?? null,
      maximumAdverseExcursion: report.performance?.maxAdverseExcursion ?? null,
      exitQuality: report.grades?.exit?.grade ?? null,
      strategyPerformance: report.grades?.entry?.grade ?? null,
      riskPerformance: report.grades?.risk?.grade ?? null,
      marketRegime: report.marketContext?.marketRegime ?? null,
      eventContext: report.marketContext ?? null,
    };
    await appendLifecycleJournal({
      tradeId: lifecycle.tradeId,
      eventType: 'EVALUATION_COMPLETED',
      state: lifecycle.state,
      previousState: lifecycle.previousState,
      source: 'trade-evaluation',
      reason: 'Existing trade evaluation engine generated the post-trade report.',
      confidence: lifecycle.confidence,
      payload: lifecycle.evaluationSummary ?? {},
    });
  } catch (error: any) {
    lifecycle.evaluationSummary = {
      status: 'UNAVAILABLE',
      reason: String(error?.message ?? error).slice(0, 300),
    };
  }
}

async function applyMonitoringDecision(
  lifecycle: TradeLifecycleDocument,
  decision: LifecycleMonitoringDecision,
  nextEvaluationAt: Date
): Promise<void> {
  const confidenceChanged =
    lifecycle.confidence.current !== decision.confidence.current ||
    lifecycle.confidence.trend !== decision.confidence.trend;
  lifecycle.confidence = decision.confidence as any;
  lifecycle.currentAction = decision.action;
  lifecycle.reasoning = decision.reasoning;
  lifecycle.exitReason = decision.exitReason;
  lifecycle.lastEvaluatedAt = new Date();
  lifecycle.nextEvaluationAt = nextEvaluationAt;
  await lifecycle.save();
  await appendLifecycleJournal({
    tradeId: lifecycle.tradeId,
    eventType: 'MONITORING_DECISION',
    state: lifecycle.state,
    previousState: lifecycle.previousState,
    source: 'trade-lifecycle-monitor',
    reason: decision.reasoning.join(' '),
    confidence: lifecycle.confidence,
    payload: {
      action: decision.action,
      exitRequired: decision.exitRequired,
      exitReason: decision.exitReason,
    },
  });
  if (confidenceChanged) {
    await appendLifecycleJournal({
      tradeId: lifecycle.tradeId,
      eventType: 'CONFIDENCE_CHANGED',
      state: lifecycle.state,
      previousState: lifecycle.previousState,
      source: 'trade-lifecycle-monitor',
      reason: `Confidence trend is ${decision.confidence.trend}.`,
      confidence: lifecycle.confidence,
      payload: { confidence: decision.confidence },
    });
  }
}

export async function syncTradeLifecycle(now = new Date()) {
  const flags = getTradeLifecycleFlags();
  if (!flags.TRADE_LIFECYCLE_ENABLED || mongoose.connection?.readyState !== 1) {
    return { synced: 0, skipped: true, reason: !flags.TRADE_LIFECYCLE_ENABLED ? 'TRADE_LIFECYCLE_DISABLED' : 'MONGO_UNAVAILABLE' };
  }

  const positions = await AutomationPositionModel.find({
    status: { $in: ['PENDING_ENTRY', 'OPEN', 'EXITING', 'CLOSED', 'MANUAL_REVIEW'] },
  })
    .sort({ updatedAt: -1 })
    .limit(500)
    .lean();

  let synced = 0;
  const nextEvaluationAt = new Date(now.getTime() + getTradeLifecycleScheduleMs());
  for (const position of positions as any[]) {
    const [entryIntent, candidate, evaluation, risk] = await Promise.all([
      position.entryIntentId ? OrderIntentModel.findById(position.entryIntentId).lean() : Promise.resolve(null),
      position.tradeCandidateId ? TradeCandidateModel.findById(position.tradeCandidateId).lean() : Promise.resolve(null),
      position.universeEvaluationId ? UniverseEvaluationModel.findById(position.universeEvaluationId).lean() : Promise.resolve(null),
      position.riskDecisionId ? RiskDecisionModel.findById(position.riskDecisionId).lean() : Promise.resolve(null),
    ]);
    const lifecycle = await upsertLifecycleRecord(position, candidate);
    const target = targetStateFromAutomationPosition(position, entryIntent);
    await advanceLifecycle(lifecycle, target, {
      automationPositionStatus: position.status,
      entryIntentStatus: entryIntent?.status ?? null,
      exitIntentId: position.exitIntentId ?? null,
    });
    if (position.status === 'CLOSED') {
      await maybeRunEvaluation(lifecycle, position);
      await advanceLifecycle(lifecycle, 'ARCHIVED', { closedAt: iso(position.closedAt), exitReason: position.exitReason ?? null });
    }
    const input = buildEvaluationInput({ lifecycle, position, candidate, evaluation, risk, now });
    const decision = evaluateLifecycleMonitoring(input);
    await applyMonitoringDecision(lifecycle, decision, nextEvaluationAt);
    synced += 1;
  }
  return { synced, skipped: false, reason: null };
}

export async function getLifecycleStatus() {
  const flags = getTradeLifecycleFlags();
  const [health, counts, latestDecision] = await Promise.all([
    getAutomationHealth().catch(() => null),
    TradeLifecycleModel.aggregate([{ $group: { _id: '$state', count: { $sum: 1 } } }]).catch(() => []),
    TradeLifecycleModel.findOne({}).sort({ lastEvaluatedAt: -1, updatedAt: -1 }).lean().catch(() => null),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    flags,
    aiStatus: health?.automationReady ? 'READY' : 'UNAVAILABLE',
    paperTrading: true,
    market: health?.gates?.marketClock?.state ?? 'UNKNOWN',
    currentStrategy: latestDecision?.strategyVersionId ?? null,
    currentRegime: latestDecision?.evaluationSummary?.marketRegime ?? null,
    nextEvaluation: iso(latestDecision?.nextEvaluationAt),
    currentDecision: latestDecision
      ? {
          watching: latestDecision.optionSymbol,
          recommendation: latestDecision.currentAction,
          confidence: latestDecision.confidence.current,
          reason: latestDecision.reasoning.join(' '),
        }
      : null,
    counts: Object.fromEntries((counts as any[]).map((row) => [row._id, row.count])),
    schedulers: {
      evaluation: getSchedulerStatus(),
      monitor: getMonitorStatus(),
    },
  };
}

export async function listLifecycleActive() {
  await syncTradeLifecycle();
  return TradeLifecycleModel.find({ state: { $in: ['PENDING_ENTRY', 'ENTRY_SUBMITTED', 'ENTRY_FILLED', 'MONITORING', 'PARTIAL_EXIT', 'EXIT_PENDING'] } })
    .sort({ updatedAt: -1 })
    .lean();
}

export async function listLifecyclePending() {
  await syncTradeLifecycle();
  return TradeLifecycleModel.find({ state: { $in: ['NEW', 'PENDING_ENTRY', 'ENTRY_SUBMITTED'] } })
    .sort({ updatedAt: -1 })
    .lean();
}

export async function listLifecycleHistory(limit = 100) {
  await syncTradeLifecycle();
  return TradeLifecycleModel.find({ state: { $in: ['EXIT_FILLED', 'EVALUATION', 'ARCHIVED'] } })
    .sort({ archivedAt: -1, updatedAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 500))
    .lean();
}

export async function listLifecycleTimeline(tradeId?: string, limit = 200) {
  const lifecycleEvents = await listLifecycleJournal(tradeId, limit);
  if (tradeId) return lifecycleEvents;
  const automationEvents = await AutomationEventModel.find({})
    .sort({ timestamp: -1 })
    .limit(Math.min(Math.max(limit, 1), 500))
    .lean()
    .catch(() => []);
  return [...lifecycleEvents, ...automationEvents].sort((a: any, b: any) => {
    const aTime = Date.parse(iso(a.at ?? a.timestamp) ?? '');
    const bTime = Date.parse(iso(b.at ?? b.timestamp) ?? '');
    return bTime - aTime;
  }).slice(0, limit);
}

export async function listLifecycleEvaluations(limit = 100) {
  await syncTradeLifecycle();
  const records = await TradeLifecycleModel.find({ evaluationSummary: { $ne: null } })
    .sort({ updatedAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 500))
    .lean();
  const reports = await Promise.all(
    records.map(async (record: any) => {
      if (!record.evaluationReportId) return null;
      return getTradeReportById(record.tradeId).catch(() => null);
    })
  );
  return records.map((record, index) => ({ lifecycle: record, report: reports[index] }));
}
