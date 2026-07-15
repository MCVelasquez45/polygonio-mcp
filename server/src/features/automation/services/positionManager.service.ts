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

// Terminal broker states that mean an exit order FAILED with nothing (further)
// to sell — the only states from which an automatic exit retry is over-sell
// safe. FILLED is handled by the close path; REPLACED continues its lineage.
const EXIT_FAILED_TERMINAL_STATES: ReadonlySet<string> = new Set(['CANCELLED', 'REJECTED', 'EXPIRED']);

export type ReconcileExitResult = {
  closed: boolean;
  escalated: boolean;
  retried: boolean;
};

/**
 * Submit a deterministic EXIT for an open position through the durable intent
 * journal. Idempotent: the EXIT intent key is position-and-attempt scoped
 * (distinct from the ENTRY key and from every other position's exit), and a
 * position already EXITING/CLOSED is never re-exited (dedupe of concurrent
 * triggers). Marks the position EXITING atomically, then places attempt #1.
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
    { $set: { status: 'EXITING', exitReason: reason, exitAttemptCount: 1, exitFilledQty: 0 } }
  );
  if (claim.modifiedCount !== 1) return null;
  position.status = 'EXITING';
  position.exitReason = reason;
  position.exitAttemptCount = 1;
  position.exitFilledQty = position.exitFilledQty ?? 0;

  const { intent } = await placeExitOrder(position, adapter, reason, now);
  return intent;
}

/**
 * Place ONE exit order for an EXITING position (first attempt or a retry). The
 * quantity is the still-unsold remainder; the client_order_id is deterministic
 * per (position, attempt). Applies any immediate fill and finalizes the close.
 */
async function placeExitOrder(
  position: AutomationPositionDocument,
  adapter: PaperBrokerAdapter,
  reason: ExitReason,
  now: Date
): Promise<{ intent: OrderIntentDocument; closed: boolean }> {
  const remainingQty = Math.max(1, position.filledQty - (position.exitFilledQty ?? 0));
  const { intent } = await createOrderIntent({
    automationSessionId: position.automationSessionId,
    strategyVersionId: position.strategyVersionId,
    underlying: position.underlying,
    signalDirection: 'SELL', // long options are closed with SELL
    closedBarTimestamp: position.openedAt ?? now, // stable per-position basis
    intentType: 'EXIT',
    // Position-and-attempt scope: exactly one broker identity per exit attempt,
    // and never a collision with another position's exit.
    idempotencyScope: `exit:${String(position._id)}:${position.exitAttemptCount}`,
    optionSymbol: position.optionSymbol,
    quantity: remainingQty,
    orderType: 'market', // exits prioritize certainty of close over price
    timeInForce: 'day',
  });
  position.exitIntentId = String(intent._id);
  position.exitSubmittedAt = now;
  await position.save();

  const result = await submitIntent(String(intent._id), adapter);
  if (result.brokerOrder) {
    position.exitBrokerOrderId = result.brokerOrder.brokerOrderId;
    applyExitFill(position, result.brokerOrder);
    await position.save();
    if ((position.status as string) === 'CLOSED') await finalizeClose(position, adapter, now);
  }
  logAutomationEvent({
    service: 'position',
    event: 'EXIT_SUBMITTED',
    severity: reason === 'EMERGENCY_STOP' ? 'warning' : 'info',
    automationSessionId: position.automationSessionId,
    intentId: String(intent._id),
    symbol: position.optionSymbol,
    payload: { reason, attempt: position.exitAttemptCount, quantity: remainingQty, outcome: result.outcome },
  });
  return { intent, closed: (position.status as string) === 'CLOSED' };
}

/**
 * Apply an EXIT broker-order snapshot. When the exit order is fully filled the
 * position closes on broker truth; realized P&L + risk counters are recorded
 * exactly once via the accounting loop. Cumulative exit fill only advances.
 */
export function applyExitFill(position: AutomationPositionDocument, order: BrokerOrder): void {
  if (position.status === 'CLOSED') return;
  if (order.brokerOrderId) position.exitBrokerOrderId = order.brokerOrderId;
  // Retries only follow zero-fill terminals, so the current order's cumulative
  // fill is the position's cumulative exit fill (monotonic guard regardless).
  if (order.filledQty > (position.exitFilledQty ?? 0)) position.exitFilledQty = order.filledQty;
  if (order.status === 'FILLED' && order.filledQty >= position.filledQty && order.avgFillPrice != null) {
    position.avgExitPrice = order.avgFillPrice;
    position.status = 'CLOSED';
    position.closedAt = position.closedAt ?? new Date();
  }
}

/** Record realized P&L + risk counters (idempotent) and log the close. */
async function finalizeClose(
  position: AutomationPositionDocument,
  adapter: PaperBrokerAdapter,
  now: Date
): Promise<void> {
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

/** Whether the current exit has exceeded the configured EXITING timeout. */
function exitTimedOut(position: AutomationPositionDocument, now: Date, timeoutMs: number): boolean {
  const base = position.exitSubmittedAt?.getTime();
  return base != null && now.getTime() - base > timeoutMs;
}

/**
 * Park an EXITING position in MANUAL_REVIEW — the last-resort escalation that
 * guarantees an exit is never silently abandoned. Ownership is retained; an
 * operator resolves it. Idempotent (no-op if already MANUAL_REVIEW/CLOSED).
 */
async function escalateExitToManualReview(
  position: AutomationPositionDocument,
  reasonCode: string,
  detail: string,
  now: Date
): Promise<ReconcileExitResult> {
  const claim = await AutomationPositionModel.updateOne(
    { _id: position._id, status: 'EXITING' },
    { $set: { status: 'MANUAL_REVIEW', manualReviewReason: `${reasonCode}: ${detail}`, lastBrokerReconciledAt: now } }
  );
  if (claim.modifiedCount !== 1) return { closed: false, escalated: false, retried: false };
  position.status = 'MANUAL_REVIEW';
  position.manualReviewReason = `${reasonCode}: ${detail}`;
  logAutomationEvent({
    service: 'position',
    event: 'POSITION_EXIT_ESCALATED_MANUAL_REVIEW',
    severity: 'critical',
    automationSessionId: position.automationSessionId,
    symbol: position.optionSymbol,
    payload: { reason: reasonCode, detail, exitAttemptCount: position.exitAttemptCount, exitBrokerOrderId: position.exitBrokerOrderId },
  });
  return { closed: false, escalated: true, retried: false };
}

/** Retry the exit if attempts remain and it is over-sell safe; else escalate. */
async function retryOrEscalateExit(
  position: AutomationPositionDocument,
  adapter: PaperBrokerAdapter,
  reasonCode: string,
  now: Date
): Promise<ReconcileExitResult> {
  const { maxExitRetries } = getExitPolicyConfig();
  if (position.exitAttemptCount >= maxExitRetries) {
    return escalateExitToManualReview(
      position,
      REASON.EXIT_RETRIES_EXHAUSTED,
      `exit failed after ${position.exitAttemptCount} attempt(s) (${reasonCode})`,
      now
    );
  }
  position.exitAttemptCount += 1;
  logAutomationEvent({
    service: 'position',
    event: 'EXIT_RETRY_SCHEDULED',
    severity: 'warning',
    automationSessionId: position.automationSessionId,
    symbol: position.optionSymbol,
    payload: { reason: REASON.EXIT_RETRY_SCHEDULED, cause: reasonCode, attempt: position.exitAttemptCount },
  });
  const { closed } = await placeExitOrder(position, adapter, position.exitReason ?? 'HARD_STOP', now);
  return { closed, escalated: false, retried: !closed };
}

/**
 * Reconcile an EXITING position against broker truth and drive it to a terminal
 * resolution. Deterministic outcomes, in order:
 *   FILLED                         → CLOSED (realized P&L recorded once)
 *   still working, within timeout  → continue monitoring
 *   still working, past timeout    → MANUAL_REVIEW
 *   rejected/cancelled/expired,
 *     zero fill, attempts remain   → retry (new exit order)
 *   rejected/cancelled/expired,
 *     retries exhausted            → MANUAL_REVIEW
 *   terminal after a PARTIAL fill  → MANUAL_REVIEW (never auto-retry: over-sell)
 *   broker unreachable, timeout    → MANUAL_REVIEW
 * A position NEVER remains indefinitely in EXITING and is never orphaned.
 */
export async function reconcileExit(
  position: AutomationPositionDocument,
  adapter: PaperBrokerAdapter,
  now: Date = new Date()
): Promise<ReconcileExitResult> {
  if (position.status !== 'EXITING') return { closed: position.status === 'CLOSED', escalated: false, retried: false };
  const { exitTimeoutMs } = getExitPolicyConfig();

  // An EXITING position with no exit order on record is a failed submit — retry
  // (over-sell safe: nothing was sold) or escalate.
  if (!position.exitBrokerOrderId) {
    return retryOrEscalateExit(position, adapter, REASON.EXIT_BROKER_UNREACHABLE, now);
  }

  let order: BrokerOrder | null = null;
  let brokerReachable = true;
  try {
    order = await adapter.getOrder(position.exitBrokerOrderId);
  } catch {
    brokerReachable = false;
  }

  // Broker truth unavailable — never guess. Keep EXITING until the timeout, then
  // escalate rather than leave it unresolved.
  if (!brokerReachable || !order) {
    if (exitTimedOut(position, now, exitTimeoutMs)) {
      return escalateExitToManualReview(position, REASON.EXIT_TIMEOUT_ESCALATED, 'broker unreachable while EXITING past timeout', now);
    }
    logAutomationEvent({
      service: 'position',
      event: 'EXIT_BROKER_UNREACHABLE',
      severity: 'warning',
      automationSessionId: position.automationSessionId,
      symbol: position.optionSymbol,
      payload: { reason: REASON.EXIT_BROKER_UNREACHABLE, exitBrokerOrderId: position.exitBrokerOrderId },
    });
    return { closed: false, escalated: false, retried: false };
  }

  applyExitFill(position, order);
  await position.save();

  if ((position.status as string) === 'CLOSED') {
    await finalizeClose(position, adapter, now);
    return { closed: true, escalated: false, retried: false };
  }

  const failedTerminal = EXIT_FAILED_TERMINAL_STATES.has(order.status);
  const partialFill = order.filledQty > 0 && order.filledQty < position.filledQty;

  if (failedTerminal) {
    if (partialFill) {
      // Ambiguous unsold remainder — auto-retrying risks over-selling. Escalate.
      return escalateExitToManualReview(
        position,
        REASON.EXIT_PARTIAL_TERMINAL,
        `exit ${order.status} after partial fill ${order.filledQty}/${position.filledQty}`,
        now
      );
    }
    return retryOrEscalateExit(position, adapter, `EXIT_${order.status}`, now);
  }

  // Still working. Continue unless it has exceeded the EXITING timeout.
  if (exitTimedOut(position, now, exitTimeoutMs)) {
    return escalateExitToManualReview(position, REASON.EXIT_TIMEOUT_ESCALATED, `exit order still ${order.status} past timeout`, now);
  }
  return { closed: false, escalated: false, retried: false };
}
