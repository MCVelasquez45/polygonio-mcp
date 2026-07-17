import mongoose from 'mongoose';
import { getEntitlementBlocks, getMassiveRequestStats } from '../../../shared/data/massive';
import { writeStructuredLog } from '../../../shared/logging/safeLogging';
import { AutomationEventModel } from '../../automation/models/automationEvent.model';
import { AutomationPositionModel } from '../../automation/models/automationPosition.model';
import { AutomationSessionModel } from '../../automation/models/automationSession.model';
import { BrokerOrderModel } from '../../automation/models/brokerOrder.model';
import { ContractSelectionModel } from '../../automation/models/contractSelection.model';
import { OrderIntentModel, UNRESOLVED_INTENT_STATUSES } from '../../automation/models/orderIntent.model';
import { RiskDecisionModel } from '../../automation/models/riskDecision.model';
import { TradeCandidateModel } from '../../automation/models/tradeCandidate.model';
import { UniverseEvaluationModel } from '../../automation/models/universeEvaluation.model';
import { getMonitorStatus } from '../../automation/services/monitorController.service';
import { isBrokerTruthCurrent } from '../../automation/services/orderReconciliation.service';
import { getLastReconciliation } from '../../automation/services/reconciliation.service';
import { exchangeTradingDate } from '../../automation/services/sessionDailyReset.service';
import { getSchedulerStatus } from '../../automation/services/schedulerController.service';
import { WatchlistItemModel } from '../../watchlist/watchlist.model';
import {
  TradingSessionModel,
  type SessionError,
  type SessionWarning,
  type TradingSessionDocument,
  type TradingSessionEnvironment,
  type TradingSessionHydratedDocument,
  type TradingSessionStatus,
} from '../models/tradingSession.model';

const TIMEZONE = 'America/New_York';
const GENERATOR_VERSION = 'trading-session-capture-v1';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type SessionFinalizationGate = {
  allowed: boolean;
  reasons: string[];
  warnings: string[];
};

export type TradingSessionCaptureInput = {
  tradingDate?: string;
  automationSessionId?: string | null;
  environment?: TradingSessionEnvironment;
  now?: Date;
};

type DateWindow = {
  start: Date;
  end: Date;
};

type SessionSnapshot = {
  tradingDate: string;
  timezone: string;
  environment: TradingSessionEnvironment;
  marketStatus: string;
  startedAt: Date;
  marketOpenedAt: Date | null;
  marketClosedAt: Date | null;
  automationSessionId: string | null;
  watchlist: TradingSessionDocument['watchlist'];
  evaluationSummary: TradingSessionDocument['evaluationSummary'];
  tradeSummary: TradingSessionDocument['tradeSummary'];
  orderSummary: TradingSessionDocument['orderSummary'];
  portfolioSnapshot: TradingSessionDocument['portfolioSnapshot'];
  providerSummary: TradingSessionDocument['providerSummary'];
  automationHealth: TradingSessionDocument['automationHealth'];
  references: TradingSessionDocument['references'];
  warnings: SessionWarning[];
  errors: SessionError[];
  generation: TradingSessionDocument['generation'];
  unresolved: {
    activePositions: number;
    overnightRecoveryPositions: number;
    unresolvedIntents: number;
    manualReviewPositions: number;
  };
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

function exchangeDateWindow(tradingDate: string): DateWindow {
  assertTradingDate(tradingDate);
  return {
    start: zonedMidnightUtc(tradingDate),
    end: zonedMidnightUtc(addDays(tradingDate, 1)),
  };
}

function roundCurrency(value: number): number {
  return Number(value.toFixed(2));
}

function idOf(doc: { _id?: unknown } | null | undefined): string {
  return String(doc?._id ?? '');
}

function compactIds(docs: Array<{ _id?: unknown }>): string[] {
  return docs.map(idOf).filter(Boolean);
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

function warning(code: string, message: string, extra: Partial<SessionWarning> = {}): SessionWarning {
  return { code, message, ...extra };
}

function inferEnvironment(mode: unknown): TradingSessionEnvironment {
  return String(mode ?? '').toLowerCase() === 'paper' ? 'PAPER' : 'LIVE';
}

function sessionIdFor(input: {
  tradingDate: string;
  environment: TradingSessionEnvironment;
  automationSessionId: string | null;
}): string {
  return `${input.environment.toLowerCase()}:${input.tradingDate}:${input.automationSessionId ?? 'aggregate'}`;
}

function eventTime(event: any): Date | null {
  const value = event?.timestamp;
  return value instanceof Date ? value : value ? new Date(value) : null;
}

function queryBySessionOrDate(automationSessionId: string | null, dateField: string, window: DateWindow) {
  return automationSessionId
    ? { automationSessionId }
    : { [dateField]: { $gte: window.start, $lt: window.end } };
}

async function findAutomationSessionForDate(
  tradingDate: string,
  automationSessionId?: string | null
): Promise<any | null> {
  if (automationSessionId) {
    return AutomationSessionModel.findById(automationSessionId).lean();
  }
  const window = exchangeDateWindow(tradingDate);
  return AutomationSessionModel.findOne({
    $or: [
      { lastResetTradingDate: tradingDate },
      { startedAt: { $gte: window.start, $lt: window.end } },
      { createdAt: { $gte: window.start, $lt: window.end } },
      { updatedAt: { $gte: window.start, $lt: window.end } },
    ],
  })
    .sort({ updatedAt: -1 })
    .lean();
}

async function resolveCaptureContext(input: TradingSessionCaptureInput = {}) {
  const now = input.now ?? new Date();
  const tradingDate = input.tradingDate ?? exchangeTradingDate(now);
  assertTradingDate(tradingDate);
  const automationSession = await findAutomationSessionForDate(tradingDate, input.automationSessionId ?? null);
  const automationSessionId = input.automationSessionId ?? (automationSession ? idOf(automationSession) : null);
  const environment = input.environment ?? inferEnvironment(automationSession?.mode ?? 'paper');
  return { now, tradingDate, automationSessionId, environment, automationSession };
}

function extractMarketStatus(evaluations: any[]): string {
  const latestWithClock = [...evaluations]
    .sort((a, b) => new Date(b.evaluatedAt).getTime() - new Date(a.evaluatedAt).getTime())
    .find(evaluation => evaluation.marketClockDecision && typeof evaluation.marketClockDecision === 'object');
  const state = latestWithClock?.marketClockDecision?.state;
  return typeof state === 'string' && state ? state : 'UNAVAILABLE';
}

function summarizeWarningsFromEvents(events: any[]): SessionWarning[] {
  const buckets = new Map<string, SessionWarning>();
  for (const event of events.filter(e => e.severity === 'warning')) {
    const code = `${event.service}:${event.event}`;
    const observedAt = eventTime(event);
    const existing = buckets.get(code);
    if (!existing) {
      buckets.set(code, {
        code,
        message: `Automation warning ${event.event} from ${event.service}`,
        firstObservedAt: observedAt,
        lastObservedAt: observedAt,
        count: 1,
      });
    } else {
      existing.count = (existing.count ?? 0) + 1;
      if (observedAt && (!existing.firstObservedAt || observedAt < existing.firstObservedAt)) {
        existing.firstObservedAt = observedAt;
      }
      if (observedAt && (!existing.lastObservedAt || observedAt > existing.lastObservedAt)) {
        existing.lastObservedAt = observedAt;
      }
    }
  }
  return [...buckets.values()].sort((a, b) => a.code.localeCompare(b.code));
}

function summarizeErrorsFromEvents(events: any[]): SessionError[] {
  return events
    .filter(event => event.severity === 'critical')
    .slice(0, 100)
    .map(event => ({
      code: `${event.service}:${event.event}`,
      message: `Automation critical event ${event.event}`,
      component: event.service,
      occurredAt: eventTime(event),
      recoverable: null,
    }));
}

function countRequestsByPriority(requestsByPriority: Record<string, number>): number {
  return Object.values(requestsByPriority).reduce((sum, count) => sum + (Number.isFinite(count) ? count : 0), 0);
}

function resolveProgressStatus(marketStatus: string): TradingSessionStatus {
  if (marketStatus === 'OPEN') return 'OPEN';
  if (marketStatus === 'CLOSED') return 'CLOSING';
  return 'INITIALIZING';
}

async function assignSnapshot(session: TradingSessionHydratedDocument, snapshot: SessionSnapshot): Promise<void> {
  session.tradingDate = snapshot.tradingDate;
  session.timezone = snapshot.timezone;
  session.environment = snapshot.environment;
  session.marketStatus = snapshot.marketStatus;
  session.startedAt = snapshot.startedAt;
  session.marketOpenedAt = snapshot.marketOpenedAt;
  session.marketClosedAt = snapshot.marketClosedAt;
  session.automationSessionId = snapshot.automationSessionId;
  session.watchlist = snapshot.watchlist;
  session.evaluationSummary = snapshot.evaluationSummary;
  session.tradeSummary = snapshot.tradeSummary;
  session.orderSummary = snapshot.orderSummary;
  session.portfolioSnapshot = snapshot.portfolioSnapshot;
  session.providerSummary = snapshot.providerSummary;
  session.automationHealth = snapshot.automationHealth;
  session.references = snapshot.references;
  session.warnings = snapshot.warnings;
  session.set('errors', snapshot.errors);
  session.generation = {
    ...snapshot.generation,
    attemptCount: session.generation?.attemptCount ?? snapshot.generation.attemptCount,
    lastAttemptAt: session.generation?.lastAttemptAt ?? snapshot.generation.lastAttemptAt,
  };
}

export async function getOrCreateTradingSession(
  input: TradingSessionCaptureInput = {}
): Promise<TradingSessionHydratedDocument> {
  const context = await resolveCaptureContext(input);
  const window = exchangeDateWindow(context.tradingDate);
  const sessionId = sessionIdFor(context);
  const existing = await TradingSessionModel.findOne({ sessionId });
  if (existing) return existing;
  try {
    return await TradingSessionModel.create({
      sessionId,
      tradingDate: context.tradingDate,
      timezone: TIMEZONE,
      status: 'INITIALIZING',
      environment: context.environment,
      marketStatus: 'UNAVAILABLE',
      startedAt: context.automationSession?.startedAt ?? context.automationSession?.createdAt ?? window.start,
      automationSessionId: context.automationSessionId,
      generation: {
        schemaVersion: 1,
        generatorVersion: GENERATOR_VERSION,
        generatedBy: 'server:intelligence:session-capture',
        sourceWindowStart: window.start,
        sourceWindowEnd: window.end,
        finalizedFromPersistedEvidence: false,
        lastAttemptAt: null,
        attemptCount: 0,
      },
    });
  } catch (error: any) {
    if (error?.code === 11000) {
      const raced = await TradingSessionModel.findOne({ sessionId });
      if (raced) return raced;
    }
    throw error;
  }
}

export async function buildSessionSnapshot(input: TradingSessionCaptureInput = {}): Promise<SessionSnapshot> {
  const context = await resolveCaptureContext(input);
  const window = exchangeDateWindow(context.tradingDate);
  const automationSessionId = context.automationSessionId;
  const sessionQuery = automationSessionId ? { automationSessionId } : {};
  const eventQuery = queryBySessionOrDate(automationSessionId, 'timestamp', window);
  const candidateQuery = automationSessionId
    ? { automationSessionId }
    : { $or: [{ barTimestamp: { $gte: window.start, $lt: window.end } }, { createdAt: { $gte: window.start, $lt: window.end } }] };
  const positionQuery = automationSessionId
    ? { automationSessionId }
    : {
        $or: [
          { openedAt: { $gte: window.start, $lt: window.end } },
          { closedAt: { $gte: window.start, $lt: window.end } },
          { createdAt: { $gte: window.start, $lt: window.end } },
          { updatedAt: { $gte: window.start, $lt: window.end } },
        ],
      };

  const [
    evaluations,
    candidates,
    selections,
    riskDecisions,
    intents,
    brokerOrders,
    positions,
    events,
    currentWatchlist,
  ] = await Promise.all([
    UniverseEvaluationModel.find(queryBySessionOrDate(automationSessionId, 'evaluatedAt', window)).lean(),
    TradeCandidateModel.find(candidateQuery).lean(),
    ContractSelectionModel.find(sessionQuery).lean(),
    RiskDecisionModel.find(sessionQuery).lean(),
    OrderIntentModel.find(automationSessionId ? { automationSessionId } : { createdAt: { $gte: window.start, $lt: window.end } }).lean(),
    BrokerOrderModel.find(automationSessionId ? { automationSessionId } : { createdAt: { $gte: window.start, $lt: window.end } }).lean(),
    AutomationPositionModel.find(positionQuery).lean(),
    AutomationEventModel.find(eventQuery).sort({ timestamp: 1 }).lean(),
    WatchlistItemModel.find({ enabled: true, automationEnabled: true }).select('symbol').lean().catch(() => []),
  ]);

  const warnings = summarizeWarningsFromEvents(events);
  const errors = summarizeErrorsFromEvents(events);
  const evaluatedSymbolsFromEvals = evaluations.flatMap((evaluation: any) =>
    Array.isArray(evaluation.symbolResults)
      ? evaluation.symbolResults.map((result: any) => result?.symbol).filter(Boolean)
      : []
  );
  const watchlistSymbols = unique(
    evaluations.flatMap((evaluation: any) => evaluation.configuredSymbols ?? []).concat(
      currentWatchlist.map((item: any) => item.symbol)
    )
  );
  if (!watchlistSymbols.length) {
    warnings.push(warning('WATCHLIST_NOT_CAPTURED', 'No automation watchlist symbols were captured for this session.'));
  }
  if (!evaluations.length && !candidates.length) {
    warnings.push(warning('NO_EVALUATION_EVIDENCE', 'No persisted evaluation records were found for this session window.'));
  }

  const marketStatus = extractMarketStatus(evaluations);
  if (marketStatus === 'UNAVAILABLE') {
    warnings.push(warning('MARKET_STATUS_UNAVAILABLE', 'No persisted market clock state was found for this session.'));
  }

  const signalStatuses = new Set(['SIGNAL_FOUND', 'RISK_APPROVED', 'RISK_REJECTED', 'RANKED_NOT_SELECTED']);
  const riskRejectCandidates = candidates.filter((candidate: any) => candidate.status === 'RISK_REJECTED').length;
  const rejectedRiskDecisions = riskDecisions.filter((decision: any) => decision.approved === false).length;
  const approvedRiskDecisions = riskDecisions.filter((decision: any) => decision.approved === true).length;
  const evaluationRiskRejects = evaluations.filter((evaluation: any) => evaluation.outcome === 'RISK_REJECTED').length;

  const closedPositions = positions.filter((position: any) => position.status === 'CLOSED');
  const openedPositions = positions.filter((position: any) => {
    const openedAt = position.openedAt ? new Date(position.openedAt) : position.createdAt ? new Date(position.createdAt) : null;
    return automationSessionId || (openedAt != null && openedAt >= window.start && openedAt < window.end);
  });
  const unrealizedValues = positions
    .filter((position: any) => ['OPEN', 'EXITING', 'PENDING_ENTRY'].includes(position.status))
    .map((position: any) => position.unrealizedPnl)
    .filter((value: unknown): value is number => typeof value === 'number' && Number.isFinite(value));
  const livePositions = positions.filter((position: any) => ['OPEN', 'EXITING', 'PENDING_ENTRY'].includes(position.status));
  const missingUnrealized = livePositions.length > unrealizedValues.length;
  if (missingUnrealized) {
    warnings.push(warning('UNREALIZED_PNL_PARTIAL', 'One or more live positions did not have a captured unrealized P/L value.'));
  }
  const realizedPnl = closedPositions.reduce((sum: number, position: any) => {
    if (typeof position.realizedPnl !== 'number' || !Number.isFinite(position.realizedPnl)) {
      warnings.push(
        warning('REALIZED_PNL_UNAVAILABLE', `Closed position ${idOf(position)} did not have realized P/L captured.`)
      );
      return sum;
    }
    return sum + position.realizedPnl;
  }, 0);
  const unrealizedPnlAtClose = unrealizedValues.length ? roundCurrency(unrealizedValues.reduce((sum, value) => sum + value, 0)) : null;

  const manualReviewPositions = positions.filter((position: any) => position.status === 'MANUAL_REVIEW').length;
  const unresolvedIntents = intents.filter((intent: any) => UNRESOLVED_INTENT_STATUSES.includes(intent.status)).length;
  const overnightRecoveryPositions = livePositions.filter((position: any) => position.overnightRecoveryRequired).length;
  const nonRecoveryActivePositions = livePositions.length - overnightRecoveryPositions;
  if (manualReviewPositions > 0) {
    warnings.push(warning('MANUAL_REVIEW_OPEN', `${manualReviewPositions} automation position(s) require manual review.`));
  }
  if (unresolvedIntents > 0) {
    warnings.push(warning('UNRESOLVED_INTENTS', `${unresolvedIntents} order intent(s) remain unresolved.`));
  }
  if (overnightRecoveryPositions > 0) {
    warnings.push(
      warning('OVERNIGHT_RECOVERY_PRESENT', `${overnightRecoveryPositions} active position(s) are classified as overnight recovery.`)
    );
  }

  const massive = getMassiveRequestStats();
  const entitlementBlocks = getEntitlementBlocks();
  warnings.push(
    warning(
      'PROVIDER_ERROR_COUNT_NOT_PERSISTED',
      'Provider error count is not persisted by V1; providerErrors is unavailable for this session.'
    )
  );
  warnings.push(
    warning(
      'PORTFOLIO_SNAPSHOT_NOT_CAPTURED',
      'No persisted account-level portfolio snapshot exists for this session.'
    )
  );

  const scheduler = getSchedulerStatus();
  const monitor = getMonitorStatus();
  const lastRecon = getLastReconciliation();
  const reconClean =
    context.automationSession?.reconciliationStatus === 'CLEAN' ||
    lastRecon?.status === 'CLEAN' ||
    events.some((event: any) => event.event === 'RECONCILIATION_COMPLETE' && event.payload?.status === 'CLEAN');
  const emergencyStopActivated =
    Boolean(context.automationSession?.emergencyStop?.active) ||
    events.some((event: any) => String(event.event).includes('EMERGENCY_STOP'));

  return {
    tradingDate: context.tradingDate,
    timezone: TIMEZONE,
    environment: context.environment,
    marketStatus,
    startedAt: context.automationSession?.startedAt ?? context.automationSession?.createdAt ?? window.start,
    marketOpenedAt: null,
    marketClosedAt: null,
    automationSessionId,
    watchlist: {
      symbols: watchlistSymbols,
      size: watchlistSymbols.length,
    },
    evaluationSummary: {
      windowsEvaluated: evaluations.length,
      symbolsEvaluated: evaluatedSymbolsFromEvals.length || unique(candidates.map((candidate: any) => candidate.underlying)).length,
      signalsGenerated: candidates.filter((candidate: any) => signalStatuses.has(candidate.status)).length,
      noSignalCount: candidates.filter((candidate: any) => candidate.status === 'NO_TRADE').length,
      dataRejectCount: candidates.filter((candidate: any) => candidate.status === 'DATA_REJECTED').length,
      riskRejectCount: Math.max(riskRejectCandidates, rejectedRiskDecisions, evaluationRiskRejects),
      approvedCount: approvedRiskDecisions,
    },
    tradeSummary: {
      tradesOpened: openedPositions.length,
      tradesClosed: closedPositions.length,
      winningTrades: closedPositions.filter((position: any) => (position.realizedPnl ?? 0) > 0).length,
      losingTrades: closedPositions.filter((position: any) => (position.realizedPnl ?? 0) < 0).length,
      breakevenTrades: closedPositions.filter((position: any) => (position.realizedPnl ?? null) === 0).length,
      realizedPnl: roundCurrency(realizedPnl),
      unrealizedPnlAtClose,
      totalPnl: unrealizedPnlAtClose == null ? roundCurrency(realizedPnl) : roundCurrency(realizedPnl + unrealizedPnlAtClose),
    },
    orderSummary: {
      intentsCreated: intents.length,
      ordersSubmitted: brokerOrders.length,
      fills: brokerOrders.filter((order: any) => order.status === 'FILLED' || order.filledQty >= order.qty).length,
      partialFills: brokerOrders.filter((order: any) => order.status === 'PARTIALLY_FILLED' || (order.filledQty > 0 && order.filledQty < order.qty)).length,
      cancellations: brokerOrders.filter((order: any) => ['CANCELLED', 'CANCEL_PENDING'].includes(order.status)).length,
      rejections:
        brokerOrders.filter((order: any) => order.status === 'REJECTED').length +
        intents.filter((intent: any) => ['BROKER_REJECTED', 'FAILED'].includes(intent.status)).length,
      manualReviewCount:
        manualReviewPositions +
        intents.filter((intent: any) => intent.status === 'MANUAL_REVIEW').length +
        brokerOrders.filter((order: any) => order.status === 'MANUAL_REVIEW').length,
    },
    portfolioSnapshot: null,
    providerSummary: {
      totalRequests: countRequestsByPriority(massive.requestsByPriority),
      cacheHits: massive.cacheHits,
      cacheHitRate: massive.cacheHitRate,
      rateLimitCount: massive.rateLimitResponses,
      providerErrors: null,
      entitlementRejects: Object.keys(entitlementBlocks).length,
    },
    automationHealth: {
      schedulerHealthy: scheduler.state === 'ACTIVE' && !scheduler.lastError,
      monitorHealthy: monitor.state === 'ACTIVE' && !monitor.lastError,
      reconciliationClean: reconClean,
      brokerConnected: isBrokerTruthCurrent(Date.now()),
      marketDataConnected: massive.state === 'OK',
      mongoConnected: mongoose.connection?.readyState === 1,
      emergencyStopActivated,
    },
    references: {
      candidateIds: compactIds(candidates),
      riskDecisionIds: compactIds(riskDecisions),
      orderIntentIds: compactIds(intents),
      brokerOrderIds: compactIds(brokerOrders),
      positionIds: compactIds(positions),
      eventIds: compactIds(events),
      closedTradeIds: compactIds(closedPositions),
    },
    warnings,
    errors,
    generation: {
      schemaVersion: 1,
      generatorVersion: GENERATOR_VERSION,
      generatedBy: 'server:intelligence:session-capture',
      sourceWindowStart: window.start,
      sourceWindowEnd: window.end,
      finalizedFromPersistedEvidence: false,
      lastAttemptAt: null,
      attemptCount: 0,
    },
    unresolved: {
      activePositions: nonRecoveryActivePositions,
      overnightRecoveryPositions,
      unresolvedIntents,
      manualReviewPositions,
    },
  };
}

export async function captureSessionProgress(input: TradingSessionCaptureInput = {}): Promise<TradingSessionHydratedDocument> {
  const session = await getOrCreateTradingSession(input);
  if (session.status === 'FINALIZED') return session;
  const snapshot = await buildSessionSnapshot({
    tradingDate: session.tradingDate,
    automationSessionId: session.automationSessionId,
    environment: session.environment,
    now: input.now,
  });
  await assignSnapshot(session, snapshot);
  session.status = resolveProgressStatus(snapshot.marketStatus);
  await session.save();
  writeStructuredLog({
    component: 'intelligence',
    module: 'trading-session-capture',
    event: 'SESSION_PROGRESS_CAPTURED',
    severity: 'info',
    sessionId: session.sessionId,
    context: {
      tradingDate: session.tradingDate,
      status: session.status,
      automationSessionId: session.automationSessionId,
      warnings: session.warnings.length,
    },
  });
  return session;
}

export function evaluateFinalizationGate(snapshot: SessionSnapshot): SessionFinalizationGate {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const scheduler = getSchedulerStatus();

  if (snapshot.marketStatus !== 'CLOSED') {
    reasons.push(`market status is ${snapshot.marketStatus}; expected CLOSED`);
  }
  if (scheduler.inFlight) {
    reasons.push('evaluation scheduler has an in-flight tick');
  }
  if (snapshot.automationHealth.reconciliationClean !== true) {
    reasons.push('reconciliation is not clean');
  }
  if (snapshot.unresolved.activePositions > 0) {
    reasons.push(`${snapshot.unresolved.activePositions} active automation position(s) remain unresolved`);
  }
  if (snapshot.unresolved.manualReviewPositions > 0) {
    reasons.push(`${snapshot.unresolved.manualReviewPositions} position(s) require manual review`);
  }
  if (snapshot.unresolved.unresolvedIntents > 0) {
    reasons.push(`${snapshot.unresolved.unresolvedIntents} order intent(s) remain unresolved`);
  }
  if (snapshot.unresolved.overnightRecoveryPositions > 0) {
    warnings.push(`${snapshot.unresolved.overnightRecoveryPositions} position(s) classified as overnight recovery`);
  }
  if (snapshot.automationHealth.emergencyStopActivated) {
    warnings.push('emergency stop was active or triggered during the session');
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    warnings,
  };
}

export async function beginFinalization(sessionId: string): Promise<TradingSessionHydratedDocument> {
  const session = await TradingSessionModel.findOne({ sessionId });
  if (!session) throw Object.assign(new Error('Trading session not found'), { status: 404 });
  if (session.status === 'FINALIZED') return session;
  session.status = 'FINALIZING';
  session.finalizationStartedAt = session.finalizationStartedAt ?? new Date();
  session.generation.lastAttemptAt = new Date();
  session.generation.attemptCount = (session.generation.attemptCount ?? 0) + 1;
  await session.save();
  return session;
}

export async function finalizeTradingSession(
  sessionId: string,
  options: { allowHistoricalBackfill?: boolean; now?: Date } = {}
): Promise<{ session: TradingSessionHydratedDocument; gate: SessionFinalizationGate; finalized: boolean; idempotent: boolean }> {
  const session = await beginFinalization(sessionId);
  if (session.status === 'FINALIZED') {
    return {
      session,
      gate: { allowed: true, reasons: [], warnings: ['session was already finalized'] },
      finalized: true,
      idempotent: true,
    };
  }
  const snapshot = await buildSessionSnapshot({
    tradingDate: session.tradingDate,
    automationSessionId: session.automationSessionId,
    environment: session.environment,
    now: options.now,
  });
  const gate = evaluateFinalizationGate(snapshot);
  const historicalOverride = Boolean(options.allowHistoricalBackfill && snapshot.tradeSummary.tradesClosed > 0);
  if (!gate.allowed && !historicalOverride) {
    await assignSnapshot(session, snapshot);
    session.status = 'FINALIZATION_FAILED';
    session.warnings = [
      ...snapshot.warnings,
      warning('FINALIZATION_DEFERRED', `Finalization deferred: ${gate.reasons.join('; ')}`, {
        count: gate.reasons.length,
      }),
    ];
    await session.save();
    writeStructuredLog({
      component: 'intelligence',
      module: 'trading-session-capture',
      event: 'SESSION_FINALIZATION_DEFERRED',
      severity: 'warning',
      sessionId: session.sessionId,
      context: { tradingDate: session.tradingDate, reasons: gate.reasons, warnings: gate.warnings },
    });
    return { session, gate, finalized: false, idempotent: false };
  }

  await assignSnapshot(session, snapshot);
  if (historicalOverride && !gate.allowed) {
    session.warnings = [
      ...snapshot.warnings,
      warning('HISTORICAL_BACKFILL_FINALIZED_WITH_WARNINGS', `Historical backfill finalized with gate warnings: ${gate.reasons.join('; ')}`),
    ];
  }
  session.status = 'FINALIZED';
  session.finalizedAt = options.now ?? new Date();
  session.generation.finalizedFromPersistedEvidence = true;
  await session.save();
  writeStructuredLog({
    component: 'intelligence',
    module: 'trading-session-capture',
    event: 'SESSION_FINALIZED',
    severity: 'info',
    sessionId: session.sessionId,
    context: {
      tradingDate: session.tradingDate,
      realizedPnl: session.tradeSummary.realizedPnl,
      tradesClosed: session.tradeSummary.tradesClosed,
      warnings: session.warnings.length,
    },
  });
  return { session, gate, finalized: true, idempotent: false };
}

export async function retryFailedFinalization(sessionId: string) {
  const session = await TradingSessionModel.findOne({ sessionId });
  if (!session) throw Object.assign(new Error('Trading session not found'), { status: 404 });
  if (session.status !== 'FINALIZATION_FAILED') {
    return finalizeTradingSession(sessionId);
  }
  return finalizeTradingSession(sessionId);
}

export async function backfillTradingSession(tradingDate: string) {
  assertTradingDate(tradingDate);
  const session = await captureSessionProgress({ tradingDate, environment: 'PAPER' });
  return finalizeTradingSession(session.sessionId, { allowHistoricalBackfill: true });
}

export async function listTradingSessions(limit = 50): Promise<TradingSessionHydratedDocument[]> {
  return TradingSessionModel.find()
    .sort({ tradingDate: -1, updatedAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 200));
}

export async function getLatestTradingSession(): Promise<TradingSessionHydratedDocument | null> {
  return TradingSessionModel.findOne().sort({ tradingDate: -1, updatedAt: -1 });
}

export async function getTradingSessionByDate(tradingDate: string): Promise<TradingSessionHydratedDocument[]> {
  assertTradingDate(tradingDate);
  return TradingSessionModel.find({ tradingDate }).sort({ updatedAt: -1 });
}

export async function getTradingSessionBySessionId(sessionId: string): Promise<TradingSessionHydratedDocument | null> {
  return TradingSessionModel.findOne({ sessionId });
}

export function validateTradingDate(value: string): void {
  assertTradingDate(value);
}
