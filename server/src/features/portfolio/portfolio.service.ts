import mongoose from 'mongoose';
import { getAutomationHealth } from '../automation/services/automationHealth.service';
import type { PaperBrokerAdapter } from '../automation/services/brokerAdapter';
import {
  getAutomationRuntime,
  resolveBrokerAdapter,
} from '../automation/services/sessionRecovery.service';
import { AutomationSessionModel } from '../automation/models/automationSession.model';
import {
  AutomationPositionModel,
  LIVE_POSITION_STATUSES,
} from '../automation/models/automationPosition.model';
import { OrderIntentModel } from '../automation/models/orderIntent.model';
import { UniverseEvaluationModel } from '../automation/models/universeEvaluation.model';
import { ContractSelectionModel } from '../automation/models/contractSelection.model';
import { TradeCandidateModel } from '../automation/models/tradeCandidate.model';
import {
  logAutomationEvent,
  listAutomationEvents,
  listSessionEvents,
} from '../automation/services/automationAudit.service';
import { flattenAllOnEmergency } from '../automation/automation.scheduler';
import { submitExit } from '../automation/services/positionManager.service';
import { getBrokerStreamHealth } from '../automation/services/orderReconciliation.service';
import { getSchedulerStatus, SCHEDULER_SCOPE } from '../automation/services/schedulerController.service';
import { getMonitorStatus, MONITOR_SCOPE } from '../automation/services/monitorController.service';
import { BrokerOrderModel } from '../automation/models/brokerOrder.model';
import { isAutomationOwned } from '../automation/services/automationOwnership.service';
import type { BrokerOrder, BrokerPosition } from '../automation/automation.types';
import { SchedulerLeaseModel } from '../automation/models/schedulerLease.model';
import {
  getMassiveRequestStats,
  getMassiveOptionQuoteSnapshot,
  getMassiveOptionContractSnapshot,
} from '../../shared/data/massive';
import { underlyingFromOccSymbol } from '../automation/services/automationMarketData.service';
import { computeDteEt } from '../../shared/time/tradingCalendar';
import { listWatchlistWithLiveStatus } from '../watchlist/watchlist.service';
import {
  getSignalMode,
  getSubmissionEnabled,
  getMarketHoursConfig,
  getExecutionConfig,
  getExitPolicyConfig,
} from '../automation/automation.config';

/** Extract the ISO expiration (YYYY-MM-DD) encoded in an OCC option symbol. */
export function expirationFromOccSymbol(optionSymbol: string | null | undefined): string | null {
  if (!optionSymbol) return null;
  const bare = optionSymbol.toUpperCase().replace(/^O:/, '');
  const m = bare.match(/^[A-Z]+(\d{2})(\d{2})(\d{2})[CP]\d{8}$/);
  return m ? `20${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * Best-effort NBBO for a held option contract, used only to enrich the read-side
 * visibility snapshot. Never throws into the snapshot builder — a data-provider
 * hiccup must not blank the operator console. Shares the 3s cache + OPEN_POSITION
 * priority with the monitor's mark fetch, so this adds no extra provider load
 * when the monitor is already polling the same contract.
 */
async function fetchHeldNbbo(optionSymbol: string): Promise<{
  bid: number | null;
  ask: number | null;
  mid: number | null;
  spreadPct: number | null;
} | null> {
  try {
    const quote = await getMassiveOptionQuoteSnapshot(underlyingFromOccSymbol(optionSymbol), optionSymbol);
    const bid = Number.isFinite(quote.bid as number) ? (quote.bid as number) : null;
    const ask = Number.isFinite(quote.ask as number) ? (quote.ask as number) : null;
    const mid =
      Number.isFinite(quote.mid as number) ? (quote.mid as number) : bid != null && ask != null ? (bid + ask) / 2 : null;
    const spreadPct = bid != null && ask != null && mid != null && mid > 0 ? ((ask - bid) / mid) * 100 : null;
    return { bid, ask, mid, spreadPct };
  } catch {
    return null;
  }
}

// Phase 2C — Portfolio command-center aggregation.
//
// Joins BROKER TRUTH (Alpaca paper positions/orders/account) with AUTOMATION
// CONTEXT (sessions, positions, intents, health, risk) on the server so the UI
// never has to correlate unrelated records. Ownership is PROVEN by persisted
// client_order_id / automation-position links — a broker position is treated as
// automation-owned only when such a link exists; everything else is manual.

function normalizeSymbol(symbol: string): string {
  return symbol.toUpperCase().replace(/^O:/, '');
}

function adapter(): PaperBrokerAdapter {
  const runtime = getAutomationRuntime();
  return runtime.adapter ?? resolveBrokerAdapter();
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

function toFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function todayStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

const BROKER_TERMINAL_STATUSES = new Set(['FILLED', 'CANCELLED', 'CANCELED', 'REJECTED', 'EXPIRED']);
const LIVE_INTENT_STATUSES = new Set(['CREATED', 'APPROVED_AWAITING_EXECUTION', 'SUBMITTING', 'SUBMITTED', 'MANUAL_REVIEW']);

function deriveSymbolOutcome(result: any, evaluation: any): string {
  if (evaluation?.selectedSymbol === result.symbol && evaluation?.orderIntentId) return 'ORDER_SUBMITTED';
  if (evaluation?.selectedSymbol === result.symbol && evaluation?.riskApproved === false) return 'RISK_REJECTED';
  const reasons = Array.isArray(result.reasonCodes) ? result.reasonCodes : [];
  if (reasons.some((r: string) => /DATA|STALE|INCOMPLETE|INSUFFICIENT|LIQUIDITY|VOLUME|CONTRACT|SPREAD/.test(String(r)))) {
    return 'DATA_REJECTED';
  }
  if (result.direction) return result.eligible ? 'NO_SIGNAL' : 'DATA_REJECTED';
  return 'NO_SIGNAL';
}

function eventId(event: any): string {
  return String(event?._id ?? `${iso(event?.timestamp) ?? ''}:${event?.event ?? ''}:${event?.symbol ?? ''}`);
}

export type OwnedBrokerPosition = BrokerPosition & {
  source: 'AUTOMATION' | 'MANUAL';
  automation: {
    positionId: string;
    automationSessionId: string;
    strategyVersionId: string;
    direction: string;
    status: string;
    avgEntryPrice: number | null;
    exitPolicy: unknown;
    stopPrice: number | null;
    targetPrice: number | null;
    openedAt: Date | null;
    unrealizedPnl: number | null;
  } | null;
};

export type OwnedBrokerOrder = BrokerOrder & {
  source: 'AUTOMATION' | 'MANUAL';
  automation: {
    intentId: string | null;
    intentType: string | null;
    status: string | null;
    automationSessionId: string | null;
    brokerLifecycleState?: string | null;
    filledQty?: number | null;
    remainingQty?: number | null;
    avgFillPrice?: number | null;
    submittedAt?: Date | null;
    lastBrokerUpdateAt?: Date | null;
    manualReviewReason?: string | null;
  } | null;
};

/**
 * Aggregate the full operational picture. Broker truth is fetched live from the
 * paper adapter; automation context comes from durable records. Ownership is
 * inferred ONLY from proven links, never assumed.
 */
export async function getPortfolioOperations() {
  const broker = adapter();
  const [account, brokerPositions, brokerOrders, health] = await Promise.all([
    broker.getAccount().catch(() => null),
    broker.listPositions().catch(() => [] as BrokerPosition[]),
    broker.listOpenOrders().catch(() => [] as BrokerOrder[]),
    getAutomationHealth().catch(() => null),
  ]);

  const mongoUp = mongoose.connection?.readyState === 1;
  const autoPositions = mongoUp
    ? await AutomationPositionModel.find({ status: { $in: [...LIVE_POSITION_STATUSES, 'CLOSED'] } })
        .sort({ updatedAt: -1 })
        .limit(200)
        .lean()
    : [];
  const intents = mongoUp
    ? await OrderIntentModel.find({}).sort({ createdAt: -1 }).limit(300).lean()
    : [];
  const sessions = mongoUp ? await AutomationSessionModel.find({}).sort({ updatedAt: -1 }).limit(50).lean() : [];

  // Index automation context by the proven broker links.
  const autoBySymbol = new Map<string, (typeof autoPositions)[number]>();
  for (const pos of autoPositions) {
    if (LIVE_POSITION_STATUSES.includes(pos.status as any) && isAutomationOwned(pos as any)) {
      autoBySymbol.set(normalizeSymbol(pos.optionSymbol), pos);
    }
  }
  const intentByClientOrderId = new Map<string, (typeof intents)[number]>();
  for (const intent of intents) intentByClientOrderId.set(intent.clientOrderId, intent);

  const positions: OwnedBrokerPosition[] = brokerPositions.map(pos => {
    const auto = autoBySymbol.get(normalizeSymbol(pos.symbol));
    return {
      ...pos,
      source: auto ? 'AUTOMATION' : 'MANUAL',
      automation: auto
        ? {
            positionId: String(auto._id),
            automationSessionId: auto.automationSessionId,
            strategyVersionId: auto.strategyVersionId,
            direction: auto.direction,
            status: auto.status,
            avgEntryPrice: auto.avgEntryPrice,
            exitPolicy: auto.exitPolicy,
            stopPrice: auto.exitPolicy?.stopPrice ?? null,
            targetPrice: auto.exitPolicy?.targetPrice ?? null,
            openedAt: auto.openedAt,
            unrealizedPnl: auto.unrealizedPnl,
          }
        : null,
    };
  });

  // Durable broker-order journal (Sprint 3), keyed by client_order_id — the
  // source of lifecycle state / cumulative fill / avg price / timestamps.
  const journalRows = mongoUp
    ? await BrokerOrderModel.find({ intentId: { $ne: null } }).sort({ updatedAt: -1 }).limit(300).lean()
    : [];
  const journalByClientOrderId = new Map<string, (typeof journalRows)[number]>();
  for (const row of journalRows) if (row.clientOrderId) journalByClientOrderId.set(row.clientOrderId, row);

  const orders: OwnedBrokerOrder[] = brokerOrders.map(order => {
    const intent = order.clientOrderId ? intentByClientOrderId.get(order.clientOrderId) : undefined;
    const journal = order.clientOrderId ? journalByClientOrderId.get(order.clientOrderId) : undefined;
    return {
      ...order,
      source: intent ? 'AUTOMATION' : 'MANUAL',
      automation: intent
        ? {
            intentId: String(intent._id),
            intentType: intent.intentType,
            status: intent.status,
            automationSessionId: intent.automationSessionId,
            // Sprint 3 lifecycle fields (durable broker truth; null when absent).
            brokerLifecycleState: journal?.status ?? null,
            filledQty: journal?.filledQty ?? null,
            remainingQty: journal ? Math.max(0, journal.qty - journal.filledQty) : null,
            avgFillPrice: journal?.avgFillPrice ?? null,
            submittedAt: journal?.submittedAt ?? null,
            lastBrokerUpdateAt: journal?.lastBrokerUpdateAt ?? null,
            manualReviewReason: intent.status === 'MANUAL_REVIEW' ? intent.rejectionReason ?? 'manual review' : null,
          }
        : null,
    };
  });

  // Automation-owned broker orders that exist only in the journal (e.g. filled/
  // terminal, no longer in the broker's open-orders list) — surface them too.
  const openClientOrderIds = new Set(brokerOrders.map(o => o.clientOrderId).filter(Boolean) as string[]);
  const journalOnlyOrders = journalRows
    .filter(row => row.clientOrderId && !openClientOrderIds.has(row.clientOrderId))
    .map(row => {
      const intent = row.clientOrderId ? intentByClientOrderId.get(row.clientOrderId) : undefined;
      return {
        brokerOrderId: row.brokerOrderId,
        clientOrderId: row.clientOrderId,
        symbol: row.symbol,
        side: row.side,
        qty: row.qty,
        filledQty: row.filledQty,
        avgFillPrice: row.avgFillPrice,
        status: row.status,
        rawStatus: row.rawStatus,
        orderType: row.orderType,
        limitPrice: row.limitPrice,
        timeInForce: row.timeInForce,
        submittedAt: row.submittedAt,
        updatedAt: row.lastBrokerUpdateAt,
        source: 'AUTOMATION' as const,
        automation: {
          intentId: row.intentId,
          intentType: intent?.intentType ?? null,
          status: intent?.status ?? null,
          automationSessionId: row.automationSessionId,
          brokerLifecycleState: row.status,
          filledQty: row.filledQty,
          remainingQty: Math.max(0, row.qty - row.filledQty),
          avgFillPrice: row.avgFillPrice,
          submittedAt: row.submittedAt,
          lastBrokerUpdateAt: row.lastBrokerUpdateAt,
          manualReviewReason: intent?.status === 'MANUAL_REVIEW' ? intent.rejectionReason ?? 'manual review' : null,
        },
      } as unknown as OwnedBrokerOrder;
    });
  orders.push(...journalOnlyOrders);

  const risk = sessions.map(s => ({
    automationSessionId: String(s._id),
    status: s.status,
    dailyRealizedPnl: s.dailyRealizedPnl,
    dailyTradeCount: s.dailyTradeCount,
    consecutiveLossCount: s.consecutiveLossCount,
    currentDrawdown: s.currentDrawdown,
    maxDrawdown: s.maxDrawdown,
    lastTradeResult: s.lastTradeResult,
    emergencyStop: s.emergencyStop?.active ?? false,
    reconciliationStatus: s.reconciliationStatus,
  }));

  const brokerStream = getBrokerStreamHealth();

  return {
    brokerTruth: { account, positions: brokerPositions, orders: brokerOrders },
    automationContext: {
      sessions,
      positions: autoPositions,
      positionsBySymbol: positions,
      ordersWithContext: orders,
    },
    manualBrokerActivity: {
      positions: positions.filter(p => p.source === 'MANUAL'),
      orders: orders.filter(o => o.source === 'MANUAL'),
    },
    health,
    runtime: {
      evaluationScheduler: getSchedulerStatus(),
      monitorScheduler: getMonitorStatus(),
    },
    brokerStreamHealth: {
      state: brokerStream.state,
      streamEnabled: brokerStream.streamEnabled,
      truthCurrent: brokerStream.truthCurrent,
      lastEventAt: brokerStream.lastEventAt,
      lastRestReconciliationAt: brokerStream.lastRestReconciliationAt,
      unresolvedContradictions: brokerStream.unresolvedContradictions,
    },
    risk,
  };
}

/** Timeline for one automation session — persisted events, never fabricated. */
export async function getSessionTimeline(sessionId: string, limit = 200) {
  return listSessionEvents(sessionId, limit);
}

/** Closed automation trades with realized outcomes. */
export async function getClosedTrades(limit = 100) {
  return AutomationPositionModel.find({ status: 'CLOSED' })
    .sort({ closedAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 500))
    .lean();
}

export async function getLatestUniverseEvaluations(limit = 5) {
  return UniverseEvaluationModel.find({}).sort({ evaluatedAt: -1 }).limit(limit).lean();
}

/**
 * Live greeks/IV/OI/day snapshot for one held position, for the cockpit's 3s poll.
 * These fields are REST-only on Massive (not streamable), so the client polls this
 * endpoint while the cockpit is open. Fail-soft: an unavailable provider yields
 * `available: false` rather than an error, so the panel shows UNAVAILABLE not a
 * crash. Uses OPEN_POSITION priority + the shared 3s cache.
 */
export async function getPositionLiveSnapshot(positionId: string) {
  const now = Date.now();
  const base = { positionId, asOf: new Date(now).toISOString() };
  if (mongoose.connection?.readyState !== 1) {
    return { ...base, available: false, reason: 'MONGO_UNAVAILABLE' as const };
  }
  let pos: any = null;
  try {
    pos = await AutomationPositionModel.findById(positionId).lean();
  } catch {
    return { ...base, available: false, reason: 'INVALID_POSITION_ID' as const };
  }
  if (!pos || !pos.optionSymbol) {
    return { ...base, available: false, reason: 'POSITION_NOT_FOUND' as const };
  }

  const optionSymbol = String(pos.optionSymbol);
  try {
    const snap: any = await getMassiveOptionContractSnapshot(optionSymbol);
    const g = snap?.greeks ?? {};
    return {
      ...base,
      available: true,
      optionSymbol,
      underlying: pos.underlying ?? null,
      greeks: {
        delta: toFiniteNumber(g.delta),
        gamma: toFiniteNumber(g.gamma),
        theta: toFiniteNumber(g.theta),
        vega: toFiniteNumber(g.vega),
        rho: toFiniteNumber(g.rho),
      },
      impliedVolatility: toFiniteNumber(snap?.impliedVolatility),
      openInterest: toFiniteNumber(snap?.openInterest),
      dayVolume: toFiniteNumber(snap?.volume ?? snap?.day?.volume),
      breakEvenPrice: toFiniteNumber(snap?.breakEvenPrice),
      bid: toFiniteNumber(snap?.bid),
      ask: toFiniteNumber(snap?.ask),
      mid: toFiniteNumber(snap?.mid),
      daysToExpiration: computeDteEt(expirationFromOccSymbol(optionSymbol), now),
      source: 'contract-snapshot' as const,
    };
  } catch {
    return {
      ...base,
      available: false,
      optionSymbol,
      daysToExpiration: computeDteEt(expirationFromOccSymbol(optionSymbol), now),
      reason: 'PROVIDER_UNAVAILABLE' as const,
    };
  }
}

/** Read-only automation command-center snapshot for Portfolio UI + Socket.IO. */
export async function getAutomationVisibility() {
  const ops = await getPortfolioOperations();
  const mongoUp = mongoose.connection?.readyState === 1;

  const [
    latestEvaluation,
    recentEvents,
    closedTrades,
    intents,
    leases,
    watchlist,
  ] = mongoUp
    ? await Promise.all([
        UniverseEvaluationModel.findOne({}).sort({ evaluatedAt: -1 }).lean(),
        listAutomationEvents(200),
        getClosedTrades(200),
        OrderIntentModel.find({}).sort({ createdAt: -1 }).limit(300).lean(),
        SchedulerLeaseModel.find({ scope: { $in: [SCHEDULER_SCOPE, MONITOR_SCOPE] } }).lean(),
        listWatchlistWithLiveStatus().catch(() => []),
      ])
    : [null, [], [], [], [], []];

  const scheduler = ops.runtime?.evaluationScheduler ?? getSchedulerStatus();
  const monitor = ops.runtime?.monitorScheduler ?? getMonitorStatus();
  const massive = getMassiveRequestStats();
  const sessions = (ops.automationContext.sessions ?? []) as any[];
  const risk = ops.risk ?? [];
  const primarySession =
    sessions.find((s) => ['READY', 'RUNNING', 'PAUSED'].includes(String(s.status))) ??
    sessions[0] ??
    null;
  const activeRisk = risk.find((r) => r.automationSessionId === String(primarySession?._id)) ?? risk[0] ?? null;
  const paused = sessions.some((s) => s.status === 'PAUSED');
  const schedulerActive = scheduler?.state === 'ACTIVE';
  const monitorActive = monitor?.state === 'ACTIVE';
  const automationReady = Boolean(ops.health?.automationReady);
  const automationState =
    primarySession?.status === 'PAUSED'
      ? 'PAUSED'
      : primarySession?.status === 'EMERGENCY_STOPPED'
        ? 'STOPPED'
        : schedulerActive && monitorActive && automationReady && !paused
          ? 'RUNNING'
          : automationReady
            ? 'READY'
            : ops.health
              ? 'ERROR'
              : 'STOPPED';

  const orders = (ops.automationContext.ordersWithContext ?? []) as any[];
  const automationOrders = orders.filter((order) => order.source === 'AUTOMATION');
  const ordersByClientOrderId = new Map<string, any>();
  const ordersByBrokerOrderId = new Map<string, any>();
  for (const order of automationOrders) {
    if (order.clientOrderId) ordersByClientOrderId.set(order.clientOrderId, order);
    if (order.brokerOrderId) ordersByBrokerOrderId.set(order.brokerOrderId, order);
  }

  const brokerPositions = (ops.automationContext.positionsBySymbol ?? []) as any[];
  const brokerPositionBySymbol = new Map<string, any>();
  for (const pos of brokerPositions) brokerPositionBySymbol.set(normalizeSymbol(pos.symbol), pos);

  const activePositions = ((ops.automationContext.positions ?? []) as any[]).filter(
    (pos) =>
      ['PENDING_ENTRY', 'OPEN', 'EXITING', 'MANUAL_REVIEW'].includes(String(pos.status)) &&
      isAutomationOwned(pos)
  );

  const markEventBySymbol = new Map<string, any>();
  for (const event of recentEvents as any[]) {
    if (!event.symbol || markEventBySymbol.has(normalizeSymbol(event.symbol))) continue;
    if (event.event === 'MONITOR_MARK_RECEIVED' || event.event === 'MONITOR_MARK_MISSING') {
      markEventBySymbol.set(normalizeSymbol(event.symbol), event);
    }
  }

  // Market-hours context for time-based exits. One fail-soft broker clock read;
  // the absolute flatten/close instants let the cockpit show real countdowns
  // rather than fabricated ones. Unknown → nulls (UI shows UNAVAILABLE).
  const marketHoursConfig = getMarketHoursConfig();
  let brokerClock: any = null;
  try {
    brokerClock = await adapter().getClock();
  } catch {
    brokerClock = null;
  }
  const closeAtMs = brokerClock?.nextClose ? new Date(brokerClock.nextClose).getTime() : null;
  const flattenAtMs = closeAtMs != null ? closeAtMs - marketHoursConfig.flattenMinutesBeforeClose * 60_000 : null;
  const finalEntryAtMs = closeAtMs != null ? closeAtMs - marketHoursConfig.finalEntryMinutesBeforeClose * 60_000 : null;

  // NBBO enrichment: one cached (3s) snapshot per held contract, in parallel and
  // fail-soft. Kills the "$0.00" lie where bid/ask/spread were hardcoded null.
  const nowMs = Date.now();
  const inFlattenWindow = flattenAtMs != null ? nowMs >= flattenAtMs : false;
  const emergencyActive = Boolean(primarySession?.emergencyStop);
  const reconciliationClean =
    String(activeRisk?.reconciliationStatus ?? primarySession?.reconciliationStatus ?? '').toUpperCase() === 'CLEAN';

  // Broker order status-history for the active positions' entry/exit orders — the
  // durable transition journal (with sources) the execution panel timelines. One
  // targeted query (≤1 open position × 2 orders), not part of the ops aggregate.
  const executionConfig = getExecutionConfig();
  const exitPolicyConfig = getExitPolicyConfig();
  const activeBrokerOrderIds = Array.from(
    new Set(
      activePositions
        .flatMap((pos) => [pos.entryBrokerOrderId, pos.exitBrokerOrderId])
        .filter((id): id is string => Boolean(id))
    )
  );
  const statusHistoryByBrokerId = new Map<string, any[]>();
  if (activeBrokerOrderIds.length) {
    try {
      const brokerOrderDocs = await BrokerOrderModel.find({ brokerOrderId: { $in: activeBrokerOrderIds } }).lean();
      for (const doc of brokerOrderDocs as any[]) {
        statusHistoryByBrokerId.set(
          String(doc.brokerOrderId),
          ((doc.statusHistory ?? []) as any[]).map((h) => ({
            at: iso(h.at),
            status: h.status,
            rawStatus: h.rawStatus ?? null,
            source: h.source ?? null,
          }))
        );
      }
    } catch {
      // fail-soft: no history rather than a broken snapshot
    }
  }

  const buildOrderCard = (
    order: any,
    role: 'ENTRY' | 'EXIT',
    brokerOrderId: string | null,
    attemptCount: number | null
  ) => {
    if (!order && !brokerOrderId) return null;
    const qty = toFiniteNumber(order?.qty);
    const filledQty = toFiniteNumber(order?.filledQty) ?? 0;
    const submittedAtMs = order?.submittedAt ? new Date(order.submittedAt).getTime() : null;
    const timeoutMs = role === 'ENTRY' ? executionConfig.entryOrderTimeoutSeconds * 1000 : exitPolicyConfig.exitTimeoutMs;
    const nonTerminal = !BROKER_TERMINAL_STATUSES.has(String(order?.status ?? '').toUpperCase());
    return {
      role,
      status: order?.status ?? null,
      rawStatus: order?.rawStatus ?? null,
      intentStatus: order?.automation?.status ?? null,
      orderType: order?.orderType ?? null,
      limitPrice: toFiniteNumber(order?.limitPrice),
      timeInForce: order?.timeInForce ?? null,
      qty,
      filledQty,
      remainingQty: order?.automation?.remainingQty ?? (qty != null ? Math.max(0, qty - filledQty) : null),
      avgFillPrice: toFiniteNumber(order?.avgFillPrice),
      attemptCount,
      brokerOrderId: order?.brokerOrderId ?? brokerOrderId ?? null,
      clientOrderId: order?.clientOrderId ?? null,
      submittedAt: iso(order?.submittedAt),
      updatedAt: iso(order?.updatedAt),
      timeoutMs,
      // A meaningful countdown only while the order is still working.
      timeoutDeadline: nonTerminal && submittedAtMs != null ? new Date(submittedAtMs + timeoutMs).toISOString() : null,
      statusHistory: brokerOrderId ? statusHistoryByBrokerId.get(String(brokerOrderId)) ?? [] : [],
    };
  };
  const nbboBySymbol = new Map<string, Awaited<ReturnType<typeof fetchHeldNbbo>>>();
  await Promise.all(
    activePositions.map(async (pos) => {
      if (!pos.optionSymbol) return;
      const key = normalizeSymbol(pos.optionSymbol);
      if (nbboBySymbol.has(key)) return;
      nbboBySymbol.set(key, await fetchHeldNbbo(pos.optionSymbol));
    })
  );

  // Opportunity attribution — the immutable "why this trade exists" record. Joins
  // the contract selection, trade candidate, and universe evaluation the position
  // was born from (targeted findById, ≤1 open position). These never change, so
  // they could be cached; kept inline for simplicity at this cardinality.
  const csIds = activePositions.map((p) => p.contractSelectionId).filter(Boolean);
  const tcIds = activePositions.map((p) => p.tradeCandidateId).filter(Boolean);
  const ueIds = activePositions.map((p) => p.universeEvaluationId).filter(Boolean);
  const [selectionDocs, candidateDocs, evaluationDocs] = mongoUp
    ? await Promise.all([
        csIds.length ? ContractSelectionModel.find({ _id: { $in: csIds } }).lean() : Promise.resolve([]),
        tcIds.length ? TradeCandidateModel.find({ _id: { $in: tcIds } }).lean() : Promise.resolve([]),
        ueIds.length ? UniverseEvaluationModel.find({ _id: { $in: ueIds } }).lean() : Promise.resolve([]),
      ])
    : [[], [], []];
  const selectionById = new Map<string, any>();
  for (const doc of selectionDocs as any[]) selectionById.set(String(doc._id), doc);
  const candidateById = new Map<string, any>();
  for (const doc of candidateDocs as any[]) candidateById.set(String(doc._id), doc);
  const evaluationById = new Map<string, any>();
  for (const doc of evaluationDocs as any[]) evaluationById.set(String(doc._id), doc);

  const selectedRankingFor = (pos: any, evaluation: any) => {
    const ranking = Array.isArray(evaluation?.ranking) ? evaluation.ranking : [];
    return (
      ranking.find((r: any) => pos.tradeCandidateId && String(r.candidateId ?? '') === String(pos.tradeCandidateId)) ??
      ranking.find((r: any) => normalizeSymbol(String(r.contractSymbol ?? '')) === normalizeSymbol(String(pos.optionSymbol ?? ''))) ??
      null
    );
  };

  const buildOpportunity = (pos: any) => {
    const selection = pos.contractSelectionId ? selectionById.get(String(pos.contractSelectionId)) : null;
    const candidate = pos.tradeCandidateId ? candidateById.get(String(pos.tradeCandidateId)) : null;
    const evaluation = pos.universeEvaluationId ? evaluationById.get(String(pos.universeEvaluationId)) : null;
    const selectedRanking = selectedRankingFor(pos, evaluation);
    const conditions = (candidate?.conditions ?? {}) as any;
    const feature = (conditions.featureSnapshot ?? {}) as any;
    const rankedCandidates = ((selection?.candidates ?? []) as any[])
      .map((c) => ({
        symbol: c.symbol,
        passed: Boolean(c.passed),
        score: toFiniteNumber(c.score),
        delta: toFiniteNumber(c.delta),
        spreadPct: toFiniteNumber(c.spreadPct),
        openInterest: toFiniteNumber(c.openInterest),
        rejectionReasons: c.rejectionReasons ?? [],
        selected: selection?.selected?.symbol === c.symbol,
      }))
      .sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity))
      .slice(0, 6);
    return {
      strategy: (candidate?.strategyConfigSnapshot as any)?.strategyKey ?? getSignalMode(),
      direction: selection?.direction ?? candidate?.signalDirection ?? selectedRanking?.direction ?? conditions.direction ?? pos.direction ?? null,
      signalConfidence: toFiniteNumber(conditions.score) ?? toFiniteNumber(selectedRanking?.symbolScore), // 0..1 options-flow score
      selectedContractSymbol: selection?.selected?.symbol ?? pos.optionSymbol ?? null,
      selectedContractScore: toFiniteNumber(selection?.selected?.score) ?? toFiniteNumber(selectedRanking?.contractScore),
      consideredCount: toFiniteNumber(selection?.consideredCount),
      passedCount: toFiniteNumber(selection?.passedCount),
      noSelectionReason: selection?.noSelectionReason ?? null,
      candidates: rankedCandidates,
      flow: {
        netPremiumTilt: toFiniteNumber(feature.netPremiumTilt),
        volumeRatio: toFiniteNumber(feature.volumeRatio),
        callPremium: toFiniteNumber(feature.callPremium),
        putPremium: toFiniteNumber(feature.putPremium),
        ivSkew: toFiniteNumber(feature.ivSkew),
      },
    };
  };

  const buildMarketContext = (pos: any) => {
    const candidate = pos.tradeCandidateId ? candidateById.get(String(pos.tradeCandidateId)) : null;
    const evaluation = pos.universeEvaluationId ? evaluationById.get(String(pos.universeEvaluationId)) : null;
    const selectedRanking = selectedRankingFor(pos, evaluation);
    const ind = (candidate?.indicatorSnapshot ?? null) as any;
    const feature = ((candidate?.conditions as any)?.featureSnapshot ?? {}) as any;
    const tilt = toFiniteNumber(feature.netPremiumTilt);
    // Trend: from EMA cross when available (equity mode), else from flow tilt.
    let trend: 'UP' | 'DOWN' | 'FLAT' | null = null;
    if (ind && Number.isFinite(ind.emaFast) && Number.isFinite(ind.emaSlow)) {
      trend = ind.emaFast > ind.emaSlow ? 'UP' : ind.emaFast < ind.emaSlow ? 'DOWN' : 'FLAT';
    } else if (tilt != null) {
      trend = tilt > 0 ? 'UP' : tilt < 0 ? 'DOWN' : 'FLAT';
    }
    const relativeVolume =
      ind && Number.isFinite(ind.barVolume) && Number.isFinite(ind.rollingVolumeAvg) && ind.rollingVolumeAvg > 0
        ? ind.barVolume / ind.rollingVolumeAvg
        : toFiniteNumber(feature.volumeRatio);
    const atrPct = ind && Number.isFinite(ind.atr) && Number.isFinite(ind.close) && ind.close > 0 ? ind.atr / ind.close : null;
    const regime = trend ? `${trend}${atrPct != null ? (atrPct >= 0.02 ? ' · HIGH VOL' : ' · LOW VOL') : ''}` : null;
    return {
      trend,
      relativeVolume,
      flowScore: toFiniteNumber((candidate?.conditions as any)?.score) ?? toFiniteNumber(selectedRanking?.symbolScore),
      regime,
      underlyingDelayed: true, // Options Advanced plan: underlying prices are delayed
    };
  };

  const activeTrades = activePositions.map((pos) => {
    const brokerPosition = brokerPositionBySymbol.get(normalizeSymbol(pos.optionSymbol));
    const entryOrder = ordersByClientOrderId.get(pos.entryClientOrderId) ?? null;
    const exitOrder = pos.exitBrokerOrderId ? ordersByBrokerOrderId.get(pos.exitBrokerOrderId) ?? null : null;
    const markEvent = markEventBySymbol.get(normalizeSymbol(pos.optionSymbol));
    const nbbo = nbboBySymbol.get(normalizeSymbol(pos.optionSymbol)) ?? null;
    const qty = toFiniteNumber(brokerPosition?.qty) ?? toFiniteNumber(pos.filledQty) ?? toFiniteNumber(pos.orderedQuantity) ?? 0;
    const avgEntry = toFiniteNumber(brokerPosition?.avgEntryPrice) ?? toFiniteNumber(pos.avgEntryPrice);
    const mark = toFiniteNumber(pos.currentMark);
    const unrealizedPnl = toFiniteNumber(brokerPosition?.unrealizedPnl) ?? toFiniteNumber(pos.unrealizedPnl);
    const entryCost = avgEntry != null ? Math.abs(qty) * avgEntry * 100 : null;
    const unrealizedPnlPct = entryCost && unrealizedPnl != null ? (unrealizedPnl / entryCost) * 100 : null;
    return {
      positionId: String(pos._id),
      underlying: pos.underlying,
      optionSymbol: pos.optionSymbol,
      direction: pos.direction,
      strategyVersionId: pos.strategyVersionId,
      automationSessionId: pos.automationSessionId,
      intentId: pos.entryIntentId,
      entryIntentId: pos.entryIntentId,
      exitIntentId: pos.exitIntentId ?? null,
      entryTime: iso(entryOrder?.submittedAt) ?? iso(pos.createdAt),
      filledTime: iso(pos.openedAt),
      contracts: qty,
      orderedQuantity: toFiniteNumber(pos.orderedQuantity),
      filledQty: toFiniteNumber(pos.filledQty) ?? 0,
      entryPrice: avgEntry,
      currentMark: mark ?? toFiniteNumber(nbbo?.mid),
      currentBid: toFiniteNumber(nbbo?.bid),
      currentAsk: toFiniteNumber(nbbo?.ask),
      currentMid: toFiniteNumber(nbbo?.mid),
      currentSpreadPct: toFiniteNumber(nbbo?.spreadPct),
      unrealizedPnl,
      unrealizedPnlPct,
      mfe: toFiniteNumber(pos.maxFavorableExcursion),
      mae: toFiniteNumber(pos.maxAdverseExcursion),
      stopPrice: toFiniteNumber(pos.exitPolicy?.stopPrice),
      targetPrice: toFiniteNumber(pos.exitPolicy?.targetPrice),
      trailingStop: Boolean(pos.exitPolicy?.trailingEnabled),
      brokerStatus: exitOrder?.status ?? entryOrder?.status ?? pos.status,
      lifecycleStatus: pos.status,
      exitReason: pos.exitReason ?? null,
      daysToExpiration: computeDteEt(expirationFromOccSymbol(pos.optionSymbol), nowMs),
      // Active exit triggers. triggerPrice + kind is enough for the cockpit to
      // compute LIVE distance from the streamed mark; we do not recompute distance
      // here (it would be stale at 10s). Mirrors exitEngine's EXIT_PRIORITY without
      // invoking trading logic.
      exitTriggers: [
        {
          key: 'STOP_LOSS',
          label: 'Stop Loss',
          kind: 'below',
          triggerPrice: toFiniteNumber(pos.exitPolicy?.stopPrice),
          armed: pos.exitPolicy?.stopPrice != null,
        },
        {
          key: 'PROFIT_TARGET',
          label: 'Profit Target',
          kind: 'above',
          triggerPrice: toFiniteNumber(pos.exitPolicy?.targetPrice),
          armed: pos.exitPolicy?.targetPrice != null,
        },
        {
          key: 'TRAILING',
          label: 'Trailing Stop',
          kind: 'trailing',
          triggerPrice: null,
          armed: Boolean(pos.exitPolicy?.trailingEnabled),
        },
        {
          key: 'MARKET_CLOSE',
          label: 'Market Close Exit',
          kind: 'time',
          triggerPrice: null,
          triggerAt: flattenAtMs != null ? new Date(flattenAtMs).toISOString() : null,
          armed: flattenAtMs != null,
        },
        { key: 'RISK', label: 'Risk Exit', kind: 'monitor', triggerPrice: null, armed: true },
      ],
      // Plain-language "why still holding" — every item is a real, evaluated
      // condition. ok:null means the input (mark) is unavailable, not "false".
      holdRationale: [
        {
          key: 'stop',
          label: 'Stop not hit',
          ok: mark == null ? null : pos.exitPolicy?.stopPrice == null ? true : mark > Number(pos.exitPolicy.stopPrice),
        },
        {
          key: 'target',
          label: 'Profit target not reached',
          ok: mark == null ? null : pos.exitPolicy?.targetPrice == null ? true : mark < Number(pos.exitPolicy.targetPrice),
        },
        { key: 'flatten', label: 'Not in close-out window', ok: !inFlattenWindow },
        { key: 'emergency', label: 'No emergency stop', ok: !emergencyActive },
        { key: 'reconciled', label: 'Broker reconciled', ok: reconciliationClean },
      ],
      execution: {
        entry: buildOrderCard(entryOrder, 'ENTRY', pos.entryBrokerOrderId ?? entryOrder?.brokerOrderId ?? null, null),
        exit: buildOrderCard(
          exitOrder,
          'EXIT',
          pos.exitBrokerOrderId ?? exitOrder?.brokerOrderId ?? null,
          toFiniteNumber(pos.exitAttemptCount)
        ),
        maxExitRetries: exitPolicyConfig.maxExitRetries,
      },
      opportunity: buildOpportunity(pos),
      marketContext: buildMarketContext(pos),
      lastQuoteTimestamp: iso(markEvent?.payload?.providerQuoteAt) ?? iso(pos.lastMarkAt),
      lastUpdateTimestamp: iso(pos.updatedAt) ?? iso(pos.lastBrokerReconciledAt),
      quoteAgeMs: toFiniteNumber(markEvent?.payload?.computedAgeMs),
      quoteFresh: markEvent?.payload?.stale === false ? true : markEvent?.payload?.stale === true ? false : null,
      brokerOrderIds: {
        entry: pos.entryBrokerOrderId ?? entryOrder?.brokerOrderId ?? null,
        exit: pos.exitBrokerOrderId ?? exitOrder?.brokerOrderId ?? null,
      },
      clientOrderIds: {
        entry: pos.entryClientOrderId,
        exit: exitOrder?.clientOrderId ?? null,
      },
      reasonForExit: pos.exitReason ?? null,
    };
  });

  const terminalOrder = (order: any) => BROKER_TERMINAL_STATUSES.has(String(order.status ?? '').toUpperCase());
  const pendingOrderClientIds = new Set<string>();
  const pendingOrdersFromBroker = automationOrders
    .filter((order) => !terminalOrder(order))
    .map((order) => {
      if (order.clientOrderId) pendingOrderClientIds.add(order.clientOrderId);
      return {
        status: order.automation?.status ?? order.status,
        brokerStatus: order.status,
        intentType: order.automation?.intentType ?? null,
        symbol: order.symbol,
        side: order.side,
        remainingQty: order.automation?.remainingQty ?? Math.max(0, Number(order.qty ?? 0) - Number(order.filledQty ?? 0)),
        quantity: order.qty,
        filledQty: order.filledQty,
        orderType: order.orderType,
        limitPrice: order.limitPrice ?? null,
        timeInForce: order.timeInForce,
        brokerOrderId: order.brokerOrderId,
        clientOrderId: order.clientOrderId,
        intentId: order.automation?.intentId ?? null,
        retryCount: null,
        submittedAt: iso(order.submittedAt ?? order.automation?.submittedAt),
        updatedAt: iso(order.updatedAt ?? order.automation?.lastBrokerUpdateAt),
      };
    });
  const pendingOrdersFromIntents = (intents as any[])
    .filter((intent) => LIVE_INTENT_STATUSES.has(String(intent.status)) && !pendingOrderClientIds.has(intent.clientOrderId))
    .map((intent) => ({
      status: intent.status,
      brokerStatus: null,
      intentType: intent.intentType,
      symbol: intent.optionSymbol ?? intent.underlying,
      side: intent.direction,
      remainingQty: intent.quantity,
      quantity: intent.quantity,
      filledQty: 0,
      orderType: intent.orderType,
      limitPrice: intent.limitPrice ?? null,
      timeInForce: intent.timeInForce,
      brokerOrderId: intent.brokerOrderId ?? null,
      clientOrderId: intent.clientOrderId,
      intentId: String(intent._id),
      retryCount: intent.attemptCount ?? 0,
      submittedAt: iso(intent.submittedAt),
      updatedAt: iso(intent.updatedAt),
    }));
  const pendingOrders = [...pendingOrdersFromBroker, ...pendingOrdersFromIntents];

  const configuredSymbols = Array.isArray((latestEvaluation as any)?.configuredSymbols)
    ? (latestEvaluation as any).configuredSymbols
    : (watchlist as any[]).filter((item) => item.enabled && item.automationEnabled).map((item) => item.symbol);
  const resultBySymbol = new Map<string, any>();
  for (const result of ((latestEvaluation as any)?.symbolResults ?? []) as any[]) {
    resultBySymbol.set(String(result.symbol).toUpperCase(), result);
  }
  const rankingBySymbol = new Map<string, any>();
  for (const rank of ((latestEvaluation as any)?.ranking ?? []) as any[]) {
    rankingBySymbol.set(String(rank.symbol).toUpperCase(), rank);
  }
  const symbolResults = configuredSymbols.map((symbol: string) => {
    const result = resultBySymbol.get(String(symbol).toUpperCase()) ?? { symbol, reasonCodes: ['NOT_EVALUATED'] };
    const rank = rankingBySymbol.get(String(symbol).toUpperCase());
    const riskCodes =
      (latestEvaluation as any)?.selectedSymbol === symbol && (latestEvaluation as any)?.riskApproved === false
        ? ((latestEvaluation as any)?.riskReasonCodes ?? [])
        : [];
    const reasonCodes = [...(result.reasonCodes ?? []), ...riskCodes];
    return {
      symbol,
      direction: result.direction ?? 'NEUTRAL',
      confidence: toFiniteNumber(result.symbolScore),
      score: toFiniteNumber(result.symbolScore),
      flow: {
        netPremium: null,
        netDelta: null,
        contracts: toFiniteNumber(result.barCount),
      },
      reason: reasonCodes.length ? reasonCodes.join(', ') : deriveSymbolOutcome(result, latestEvaluation),
      reasonCodes,
      outcome: deriveSymbolOutcome({ ...result, symbol }, latestEvaluation),
      evaluatedAt: iso((latestEvaluation as any)?.evaluatedAt),
      selectedContract: rank?.contractSymbol ?? ((latestEvaluation as any)?.selectedSymbol === symbol ? (latestEvaluation as any)?.selectedContractSymbol : null),
      riskDecision:
        (latestEvaluation as any)?.selectedSymbol === symbol
          ? (latestEvaluation as any)?.riskApproved
            ? 'APPROVED'
            : 'REJECTED'
          : null,
      liquidity: result.liquidity ?? null,
      eligible: Boolean(result.eligible),
    };
  });

  const closedToday = (closedTrades as any[]).filter((trade) => {
    const closedAt = Date.parse(iso(trade.closedAt) ?? '');
    return Number.isFinite(closedAt) && closedAt >= todayStart().getTime();
  });
  const wins = closedToday.filter((trade) => Number(trade.realizedPnl ?? 0) > 0);
  const losses = closedToday.filter((trade) => Number(trade.realizedPnl ?? 0) < 0);
  const realizedPnl = activeRisk?.dailyRealizedPnl ?? closedToday.reduce((sum, trade) => sum + Number(trade.realizedPnl ?? 0), 0);
  const unrealizedPnl = activeTrades.reduce((sum, trade) => sum + Number(trade.unrealizedPnl ?? 0), 0);
  const todayAutomationOrders = automationOrders.filter((order) => {
    const submittedAt = Date.parse(iso(order.submittedAt ?? order.updatedAt) ?? '');
    return Number.isFinite(submittedAt) && submittedAt >= todayStart().getTime();
  });
  const riskRejections = symbolResults.filter((result: any) => result.outcome === 'RISK_REJECTED').length;
  const dataRejections = symbolResults.filter((result: any) => result.outcome === 'DATA_REJECTED').length;
  const signalsGenerated = symbolResults.filter((result: any) => result.direction === 'BULLISH' || result.direction === 'BEARISH').length;

  const tradeHistory = (closedTrades as any[]).map((trade) => ({
    positionId: String(trade._id),
    underlying: trade.underlying,
    contract: trade.optionSymbol,
    direction: trade.direction,
    confidence: null,
    entry: {
      at: iso(trade.openedAt),
      price: toFiniteNumber(trade.avgEntryPrice),
    },
    exit: {
      at: iso(trade.closedAt),
      price: toFiniteNumber(trade.avgExitPrice),
      reason: trade.exitReason ?? null,
    },
    holdTimeMs:
      trade.openedAt && trade.closedAt
        ? new Date(trade.closedAt).getTime() - new Date(trade.openedAt).getTime()
        : null,
    result: Number(trade.realizedPnl ?? 0) > 0 ? 'Win' : Number(trade.realizedPnl ?? 0) < 0 ? 'Loss' : 'Flat',
    pnl: toFiniteNumber(trade.realizedPnl),
    returnPct: toFiniteNumber(trade.returnPct),
    strategyVersionId: trade.strategyVersionId,
    automationSessionId: trade.automationSessionId,
    brokerIds: {
      entry: trade.entryBrokerOrderId ?? null,
      exit: trade.exitBrokerOrderId ?? null,
    },
  }));

  return {
    generatedAt: new Date().toISOString(),
    engineStatus: {
      automationState,
      readiness: automationReady ? 'READY' : 'ERROR',
      market: ops.health?.gates?.marketClock?.state ?? scheduler?.lastTick?.marketPhase ?? null,
      scheduler: {
        state: scheduler?.state ?? 'STOPPED',
        lastTick: scheduler?.lastTickAt ?? null,
        nextTick: scheduler?.lastTickAt
          ? new Date(Date.parse(scheduler.lastTickAt) + Number(scheduler.intervalMs ?? 0)).toISOString()
          : null,
        flowWindowMinutes: scheduler?.flowWindowMinutes ?? null,
        intervalMs: scheduler?.intervalMs ?? null,
        lastSkipReason: scheduler?.lastSkipReason ?? null,
      },
      monitor: {
        state: monitor?.state ?? 'STOPPED',
        lastMonitor: monitor?.lastRun ?? monitor?.lastTickAt ?? null,
        intervalMs: monitor?.intervalMs ?? null,
        positionsMonitored: monitor?.positionsMonitored ?? 0,
        exitsTriggered: monitor?.exitsTriggered ?? 0,
      },
      broker: {
        state: ops.brokerTruth.account ? 'CONNECTED' : 'DISCONNECTED',
        paper: Boolean(ops.brokerTruth.account?.isPaper ?? ops.health?.gates?.brokerMode?.mode === 'alpaca-paper'),
        stream: ops.brokerStreamHealth,
        account: ops.brokerTruth.account
          ? {
              buyingPower: toFiniteNumber((ops.brokerTruth.account as any).buyingPower),
              equity: toFiniteNumber((ops.brokerTruth.account as any).equity),
              cash: toFiniteNumber((ops.brokerTruth.account as any).cash),
            }
          : null,
      },
      massive: {
        state: massive.state,
        cooldownUntil: massive.cooldownUntil,
      },
      mongo: {
        state: mongoUp ? 'CONNECTED' : 'DISCONNECTED',
      },
      reconciliation: activeRisk?.reconciliationStatus ?? primarySession?.reconciliationStatus ?? null,
      session: primarySession
        ? {
            id: String(primarySession._id),
            status: primarySession.status,
            pauseReason: primarySession.pauseReason ?? null,
            emergencyStop: primarySession.emergencyStop ?? null,
          }
        : null,
      leases: (leases as any[]).map((lease) => ({
        scope: lease.scope,
        ownerId: lease.ownerId,
        renewedAt: iso(lease.renewedAt),
        expiresAt: iso(lease.expiresAt),
        active: lease.expiresAt ? new Date(lease.expiresAt).getTime() > Date.now() : false,
      })),
    },
    watchlistEvaluation: {
      evaluationId: latestEvaluation ? String((latestEvaluation as any)._id) : null,
      automationSessionId: (latestEvaluation as any)?.automationSessionId ?? null,
      evaluatedAt: iso((latestEvaluation as any)?.evaluatedAt),
      universeSource: (latestEvaluation as any)?.universeSource ?? 'watchlist',
      symbolCount: configuredSymbols.length,
      symbols: configuredSymbols,
      outcome: (latestEvaluation as any)?.outcome ?? null,
      reasonCodes: (latestEvaluation as any)?.reasonCodes ?? [],
      selectedSymbol: (latestEvaluation as any)?.selectedSymbol ?? null,
      selectedContract: (latestEvaluation as any)?.selectedContractSymbol ?? null,
      riskApproved: (latestEvaluation as any)?.riskApproved ?? null,
      riskReasonCodes: (latestEvaluation as any)?.riskReasonCodes ?? [],
      results: symbolResults,
      ranking: (latestEvaluation as any)?.ranking ?? [],
      dataHealth: (latestEvaluation as any)?.dataHealth ?? null,
    },
    activeTrades,
    pendingOrders,
    timeline: (recentEvents as any[]).map((event) => ({
      id: eventId(event),
      timestamp: iso(event.timestamp),
      service: event.service,
      event: event.event,
      severity: event.severity,
      automationSessionId: event.automationSessionId ?? null,
      intentId: event.intentId ?? null,
      brokerOrderId: event.brokerOrderId ?? null,
      symbol: event.symbol ?? null,
      payload: event.payload ?? {},
    })),
    metrics: {
      todayTrades: activeRisk?.dailyTradeCount ?? closedToday.length,
      wins: wins.length,
      losses: losses.length,
      winPct: closedToday.length ? (wins.length / closedToday.length) * 100 : null,
      averageWin: wins.length ? wins.reduce((sum, trade) => sum + Number(trade.realizedPnl ?? 0), 0) / wins.length : null,
      averageLoss: losses.length ? losses.reduce((sum, trade) => sum + Number(trade.realizedPnl ?? 0), 0) / losses.length : null,
      netPnl: realizedPnl + unrealizedPnl,
      realizedPnl,
      unrealizedPnl,
      largestWinner: wins.length ? Math.max(...wins.map((trade) => Number(trade.realizedPnl ?? 0))) : null,
      largestLoser: losses.length ? Math.min(...losses.map((trade) => Number(trade.realizedPnl ?? 0))) : null,
      currentDrawdown: activeRisk?.currentDrawdown ?? null,
      consecutiveWins: null,
      consecutiveLosses: activeRisk?.consecutiveLossCount ?? null,
      averageHoldTimeMs: closedToday.length
        ? closedToday.reduce((sum, trade) => {
            if (!trade.openedAt || !trade.closedAt) return sum;
            return sum + (new Date(trade.closedAt).getTime() - new Date(trade.openedAt).getTime());
          }, 0) / closedToday.length
        : null,
      averageEntryLatencyMs: null,
      averageExitLatencyMs: null,
      currentWatchlistSize: configuredSymbols.length,
      currentEvaluations: symbolResults.length,
      riskRejections,
      dataRejections,
      signalsGenerated,
      ordersSubmitted: todayAutomationOrders.length,
      ordersFilled: todayAutomationOrders.filter((order) => String(order.status).toUpperCase() === 'FILLED').length,
      ordersCancelled: todayAutomationOrders.filter((order) => ['CANCELLED', 'CANCELED'].includes(String(order.status).toUpperCase())).length,
      exitOrders: (intents as any[]).filter((intent) => intent.intentType === 'EXIT').length,
      '429Count': massive.rateLimitResponses,
      cacheHitRate: massive.cacheHitRate,
      massiveRequests: {
        queueDepth: massive.queueDepth,
        cacheHits: massive.cacheHits,
        cacheMisses: massive.cacheMisses,
        deduplicatedRequests: massive.deduplicatedRequests,
        backgroundDropped: massive.backgroundDropped,
        activeRequests: massive.activeRequests,
        requestsByPriority: massive.requestsByPriority,
        pendingRequestsByPriority: massive.pendingRequestsByPriority,
      },
    },
    schedulerPanel: {
      currentFlowWindow: scheduler?.lastWindow ?? scheduler?.lastTick?.currentWindowKey ?? null,
      nextWindow: scheduler?.nextWindow ?? scheduler?.lastTick?.nextEligibleEvaluationAt ?? null,
      currentBaseline: (latestEvaluation as any)?.dataHealth?.baseline ?? null,
      currentWindowVolume: (latestEvaluation as any)?.dataHealth?.windowVolume ?? null,
      evaluationRunning: Boolean(scheduler?.inFlight),
      skipReason: scheduler?.lastSkipReason ?? null,
      currentQueue: massive.queueDepth,
      symbolsEvaluated: symbolResults.length,
      symbolsRemaining: Math.max(0, configuredSymbols.length - symbolResults.length),
    },
    tradeHistory,
    portfolioIntegration: {
      automationPositions: (ops.automationContext.positionsBySymbol ?? []).filter((p: any) => p.source === 'AUTOMATION'),
      manualPositions: ops.manualBrokerActivity.positions ?? [],
    },
    configuration: {
      automationEnabled: (process.env.AUTOMATION_ENABLED ?? 'true').toLowerCase() !== 'false',
      submissionEnabled: getSubmissionEnabled(),
      signalMode: getSignalMode(),
      broker: process.env.AUTOMATION_BROKER ?? 'alpaca-paper',
      alpacaPaper: (process.env.ALPACA_PAPER ?? 'true').toLowerCase() !== 'false',
    },
  };
}

// ---------------------------------------------------------------------------
// Controls — every action goes through durable state / the broker adapter.
// The UI never calls Alpaca directly.
// ---------------------------------------------------------------------------

export async function pauseSessionEntries(sessionId: string, reason: string) {
  const session = await AutomationSessionModel.findById(sessionId);
  if (!session) throw new Error(`session ${sessionId} not found`);
  if (session.status === 'READY') {
    session.status = 'PAUSED';
    session.pausedAt = new Date();
  }
  session.pauseReason = reason || 'operator paused new entries';
  await session.save();
  logAutomationEvent({
    service: 'portfolio',
    event: 'SESSION_PAUSED',
    severity: 'warning',
    automationSessionId: sessionId,
    payload: { reason: session.pauseReason },
  });
  return session.toObject();
}

export async function resumeSession(sessionId: string) {
  const session = await AutomationSessionModel.findById(sessionId);
  if (!session) throw new Error(`session ${sessionId} not found`);
  // Resume only when the health gates pass and no emergency stop is active.
  const health = await getAutomationHealth().catch(() => null);
  if (session.emergencyStop.active) throw new Error('cannot resume while emergency stop is active');
  if (session.reconciliationStatus !== 'CLEAN') throw new Error('cannot resume — reconciliation not CLEAN');
  if (!health?.automationReady) throw new Error('cannot resume — automation health gates not passing');
  if (session.status === 'PAUSED') {
    session.status = 'READY';
    session.pauseReason = null;
  }
  await session.save();
  logAutomationEvent({
    service: 'portfolio',
    event: 'SESSION_RESUMED',
    automationSessionId: sessionId,
    payload: { status: session.status },
  });
  return session.toObject();
}

export async function emergencyStopSession(sessionId: string, reason: string) {
  const session = await AutomationSessionModel.findById(sessionId);
  if (!session) throw new Error(`session ${sessionId} not found`);
  session.emergencyStop = { active: true, reason: reason || 'operator emergency stop', at: new Date() };
  session.status = 'EMERGENCY_STOPPED';
  await session.save();
  logAutomationEvent({
    service: 'portfolio',
    event: 'EMERGENCY_STOP_TRIGGERED',
    severity: 'critical',
    automationSessionId: sessionId,
    payload: { reason: session.emergencyStop.reason },
  });
  // Begin orderly exit of all open automation positions (highest-priority exit).
  const { exits } = await flattenAllOnEmergency(sessionId, adapter());
  return { session: session.toObject(), exitsTriggered: exits };
}

export async function cancelAutomationOrder(intentId: string) {
  const intent = await OrderIntentModel.findById(intentId);
  if (!intent) throw new Error(`intent ${intentId} not found`);
  if (!intent.brokerOrderId) throw new Error('intent has no broker order to cancel');
  const order = await adapter().cancelOrder(intent.brokerOrderId);
  logAutomationEvent({
    service: 'portfolio',
    event: 'ORDER_CANCEL_REQUESTED',
    automationSessionId: intent.automationSessionId,
    intentId: String(intent._id),
    payload: { brokerOrderId: intent.brokerOrderId, brokerStatus: order.status },
  });
  return order;
}

export async function closeAutomationPosition(positionId: string) {
  const position = await AutomationPositionModel.findById(positionId);
  if (!position) throw new Error(`position ${positionId} not found`);
  if (position.status !== 'OPEN') throw new Error(`position is ${position.status}, not OPEN`);
  const intent = await submitExit(position, adapter(), 'OPERATOR_CLOSE');
  return { intentId: intent ? String(intent._id) : null, status: position.status };
}
