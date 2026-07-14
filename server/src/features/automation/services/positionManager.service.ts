import { getExitPolicyConfig, REASON } from '../automation.config';
import type { BrokerOrder } from '../automation.types';
import {
  AutomationPositionModel,
  type AutomationPositionDocument,
  type ExitReason,
} from '../models/automationPosition.model';
import { OrderIntentModel, type OrderIntentDocument } from '../models/orderIntent.model';
import type { SignalDirection } from '../models/tradeCandidate.model';
import { logAutomationEvent } from './automationAudit.service';
import type { PaperBrokerAdapter } from './brokerAdapter';
import { computeExitLevels, evaluateExit, type ExitContext } from './exitEngine.service';
import { createOrderIntent, submitIntent } from './orderIntent.service';
import { recordClosedTradeRisk } from './riskAccounting.service';
// (recordClosedTradeRisk is idempotent per position via the riskCounted guard.)

// Phase 2C — automation position lifecycle manager.
//
// Owns the transitions PENDING_ENTRY → OPEN → EXITING → CLOSED, always from
// BROKER TRUTH. It never mutates a position to closed directly: closing goes
// through an idempotent EXIT intent + submitIntent + broker-confirmed fill.
// Fill application is idempotent and never regresses a terminal state.

export type EntryLinks = {
  automationSessionId: string;
  strategyVersionId: string;
  universeEvaluationId: string | null;
  tradeCandidateId: string | null;
  contractSelectionId: string | null;
  riskDecisionId: string | null;
  underlying: string;
  optionSymbol: string;
  direction: SignalDirection;
};

/**
 * Create (idempotently) the automation position for a submitted ENTRY intent,
 * then fold in the current broker-order truth. One position per entry
 * client_order_id (unique index). Safe to call repeatedly.
 */
export async function openOrUpdateEntryPosition(
  intent: OrderIntentDocument,
  brokerOrder: BrokerOrder | null,
  links: EntryLinks
): Promise<AutomationPositionDocument> {
  let position = await AutomationPositionModel.findOne({ entryClientOrderId: intent.clientOrderId });
  if (!position) {
    try {
      position = await AutomationPositionModel.create({
        source: 'AUTOMATION',
        automationSessionId: links.automationSessionId,
        strategyVersionId: links.strategyVersionId,
        universeEvaluationId: links.universeEvaluationId,
        tradeCandidateId: links.tradeCandidateId,
        contractSelectionId: links.contractSelectionId,
        riskDecisionId: links.riskDecisionId,
        underlying: links.underlying,
        optionSymbol: links.optionSymbol,
        direction: links.direction,
        entryIntentId: String(intent._id),
        entryClientOrderId: intent.clientOrderId,
        entryBrokerOrderId: intent.brokerOrderId ?? brokerOrder?.brokerOrderId ?? null,
        status: 'PENDING_ENTRY',
      });
    } catch (error: any) {
      if (error?.code === 11000) {
        position = await AutomationPositionModel.findOne({ entryClientOrderId: intent.clientOrderId });
      }
      if (!position) throw error;
    }
  }
  if (brokerOrder) applyEntryFill(position, brokerOrder);
  await position.save();
  return position;
}

/**
 * Apply an entry broker-order snapshot to the position. Idempotent and
 * monotonic: filled quantity only advances; a terminal CLOSED/EXITING position
 * is never regressed by a late entry event.
 */
export function applyEntryFill(position: AutomationPositionDocument, order: BrokerOrder): void {
  if (position.status === 'CLOSED' || position.status === 'EXITING') return;
  if (order.brokerOrderId) position.entryBrokerOrderId = order.brokerOrderId;
  if (order.qty > 0) position.orderedQuantity = order.qty;
  position.lastBrokerReconciledAt = order.updatedAt ?? new Date();

  // Only advance on new fill information (guards duplicate/out-of-order events).
  // Average entry price is taken from Alpaca's authoritative avg fill price on
  // the SAME event that advances cumulative filled quantity — never recomputed
  // from a synthetic assumption.
  if (order.filledQty > position.filledQty) {
    position.filledQty = order.filledQty;
    if (order.avgFillPrice != null) position.avgEntryPrice = order.avgFillPrice;
  }

  if (position.filledQty > 0 && position.status === 'PENDING_ENTRY') {
    position.status = 'OPEN';
    position.openedAt = position.openedAt ?? new Date();
    // Snapshot the exit policy ONCE, at first fill — later config changes must
    // not alter an already-open trade.
    if (!position.exitPolicy && position.avgEntryPrice != null) {
      const cfg = getExitPolicyConfig();
      const levels = computeExitLevels(position.avgEntryPrice, cfg.stopLossPct, cfg.profitTargetPct);
      position.exitPolicy = {
        stopLossPct: cfg.stopLossPct,
        profitTargetPct: cfg.profitTargetPct,
        trailingEnabled: cfg.trailingEnabled,
        stopPrice: levels.stopPrice,
        targetPrice: levels.targetPrice,
      };
    }
    logAutomationEvent({
      service: 'position',
      event: 'POSITION_OPENED',
      automationSessionId: position.automationSessionId,
      symbol: position.optionSymbol,
      payload: { filledQty: position.filledQty, avgEntryPrice: position.avgEntryPrice },
    });
  }
}

/** Update the monitored mark + unrealized P&L + excursions from an authoritative quote. */
export function applyMark(position: AutomationPositionDocument, mark: number | null, now: Date = new Date()): void {
  if (mark == null || !Number.isFinite(mark) || position.avgEntryPrice == null) return;
  position.currentMark = mark;
  position.lastMarkAt = now;
  const unrealized = Number(((mark - position.avgEntryPrice) * position.filledQty * 100).toFixed(2));
  position.unrealizedPnl = unrealized;
  position.maxFavorableExcursion =
    position.maxFavorableExcursion == null ? unrealized : Math.max(position.maxFavorableExcursion, unrealized);
  position.maxAdverseExcursion =
    position.maxAdverseExcursion == null ? unrealized : Math.min(position.maxAdverseExcursion, unrealized);
}

export type MonitorContext = {
  emergencyStop: boolean;
  flatten: boolean;
  brokerClosed: boolean;
  strategyInvalidated: boolean;
  /** Authoritative current option mark (mid). Null = data unavailable. */
  currentMark: number | null;
  quoteStale: boolean;
};

/**
 * Evaluate an OPEN position and, if a trigger fires, submit ONE idempotent exit.
 * Once a position is EXITING/CLOSED, no further exit is created.
 */
export async function monitorAndMaybeExit(
  position: AutomationPositionDocument,
  adapter: PaperBrokerAdapter,
  ctx: MonitorContext,
  now: Date = new Date()
): Promise<{ exited: boolean; reason: ExitReason | null }> {
  if (position.status !== 'OPEN') return { exited: false, reason: null };

  applyMark(position, ctx.currentMark, now);

  // Data outage: never invent a mark. Suppress price triggers, raise a warning,
  // keep reconciling. (Entry blocking is handled by the scheduler.)
  if (ctx.quoteStale || ctx.currentMark == null) {
    logAutomationEvent({
      service: 'position',
      event: 'MONITOR_QUOTE_STALE',
      severity: 'warning',
      automationSessionId: position.automationSessionId,
      symbol: position.optionSymbol,
      payload: { reason: REASON.MONITOR_QUOTE_STALE, lastMarkAt: position.lastMarkAt?.toISOString() ?? null },
    });
  }

  const exitContext: ExitContext = {
    emergencyStop: ctx.emergencyStop,
    flatten: ctx.flatten,
    brokerClosed: ctx.brokerClosed,
    strategyInvalidated: ctx.strategyInvalidated,
    currentMark: ctx.quoteStale ? null : ctx.currentMark,
    avgEntryPrice: position.avgEntryPrice,
    stopPrice: position.exitPolicy?.stopPrice ?? null,
    targetPrice: position.exitPolicy?.targetPrice ?? null,
  };
  const decision = evaluateExit(exitContext);
  await position.save();
  if (!decision.shouldExit || !decision.reason) return { exited: false, reason: null };

  await submitExit(position, adapter, decision.reason, now);
  return { exited: true, reason: decision.reason };
}

/**
 * Submit a deterministic EXIT for an open position through the durable intent
 * journal. Idempotent: the EXIT intent key is distinct from the ENTRY key, and
 * a position already EXITING/CLOSED is never re-exited (dedupe of concurrent
 * triggers).
 */
export async function submitExit(
  position: AutomationPositionDocument,
  adapter: PaperBrokerAdapter,
  reason: ExitReason,
  now: Date = new Date()
): Promise<OrderIntentDocument | null> {
  if (position.status !== 'OPEN') {
    logAutomationEvent({
      service: 'position',
      event: 'EXIT_SUPPRESSED_ALREADY_IN_PROGRESS',
      severity: 'info',
      automationSessionId: position.automationSessionId,
      symbol: position.optionSymbol,
      payload: { reason: REASON.EXIT_ALREADY_IN_PROGRESS, status: position.status },
    });
    return null;
  }

  // Claim the exit atomically so simultaneous triggers create only one.
  const claim = await AutomationPositionModel.updateOne(
    { _id: position._id, status: 'OPEN' },
    { $set: { status: 'EXITING', exitReason: reason } }
  );
  if (claim.modifiedCount !== 1) return null;
  position.status = 'EXITING';
  position.exitReason = reason;

  const { intent } = await createOrderIntent({
    automationSessionId: position.automationSessionId,
    strategyVersionId: position.strategyVersionId,
    underlying: position.underlying,
    signalDirection: 'SELL', // long options are closed with SELL
    closedBarTimestamp: position.openedAt ?? now, // stable per-position exit key basis
    intentType: 'EXIT',
    optionSymbol: position.optionSymbol,
    quantity: position.filledQty,
    orderType: 'market', // exits prioritize certainty of close over price
    timeInForce: 'day',
  });
  position.exitIntentId = String(intent._id);
  await position.save();

  const result = await submitIntent(String(intent._id), adapter);
  if (result.brokerOrder) {
    position.exitBrokerOrderId = result.brokerOrder.brokerOrderId;
    applyExitFill(position, result.brokerOrder);
    await position.save();
    // If the exit filled immediately, close the loop now (idempotent).
    if ((position.status as string) === 'CLOSED') {
      const account = await adapter.getAccount().catch(() => null);
      await recordClosedTradeRisk(String(position._id), account?.equity ?? null, now);
      logAutomationEvent({
        service: 'position',
        event: 'POSITION_CLOSED',
        automationSessionId: position.automationSessionId,
        symbol: position.optionSymbol,
        payload: { avgExitPrice: position.avgExitPrice, exitReason: position.exitReason },
      });
    }
  }
  logAutomationEvent({
    service: 'position',
    event: 'EXIT_SUBMITTED',
    severity: reason === 'EMERGENCY_STOP' ? 'warning' : 'info',
    automationSessionId: position.automationSessionId,
    intentId: String(intent._id),
    symbol: position.optionSymbol,
    payload: { reason, outcome: result.outcome },
  });
  return intent;
}

/**
 * Apply an EXIT broker-order snapshot. When the exit order is fully filled the
 * position closes on broker truth; realized P&L + risk counters are recorded
 * exactly once via the accounting loop.
 */
export function applyExitFill(position: AutomationPositionDocument, order: BrokerOrder): void {
  if (position.status === 'CLOSED') return;
  if (order.brokerOrderId) position.exitBrokerOrderId = order.brokerOrderId;
  if (order.status === 'FILLED' && order.filledQty >= position.filledQty && order.avgFillPrice != null) {
    position.avgExitPrice = order.avgFillPrice;
    position.status = 'CLOSED';
    position.closedAt = position.closedAt ?? new Date();
  }
}

/**
 * Reconcile an EXITING position against broker truth, close it if filled, and
 * fold the realized result into session risk counters.
 */
export async function reconcileExit(
  position: AutomationPositionDocument,
  adapter: PaperBrokerAdapter,
  now: Date = new Date()
): Promise<{ closed: boolean }> {
  if (position.status !== 'EXITING') return { closed: position.status === 'CLOSED' };
  if (!position.exitBrokerOrderId) return { closed: false };

  const order = await adapter.getOrder(position.exitBrokerOrderId).catch(() => null);
  if (order) applyExitFill(position, order);
  await position.save();

  if ((position.status as string) === 'CLOSED') {
    const account = await adapter.getAccount().catch(() => null);
    await recordClosedTradeRisk(String(position._id), account?.equity ?? null, now);
    logAutomationEvent({
      service: 'position',
      event: 'POSITION_CLOSED',
      automationSessionId: position.automationSessionId,
      symbol: position.optionSymbol,
      payload: { avgExitPrice: position.avgExitPrice, exitReason: position.exitReason },
    });
    return { closed: true };
  }
  return { closed: false };
}
