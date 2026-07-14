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
import { logAutomationEvent, listSessionEvents } from '../automation/services/automationAudit.service';
import { flattenAllOnEmergency } from '../automation/automation.scheduler';
import { submitExit } from '../automation/services/positionManager.service';
import { getBrokerStreamHealth } from '../automation/services/orderReconciliation.service';
import { BrokerOrderModel } from '../automation/models/brokerOrder.model';
import type { BrokerOrder, BrokerPosition } from '../automation/automation.types';

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
    if (LIVE_POSITION_STATUSES.includes(pos.status as any)) autoBySymbol.set(normalizeSymbol(pos.optionSymbol), pos);
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
