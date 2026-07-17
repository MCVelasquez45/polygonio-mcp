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

/**
 * Update the monitored mark + unrealized P&L + excursions from an authoritative
 * quote. `lastMarkAt` reflects the DATA's freshness, not the loop cadence: when
 * the provider supplies the quote's own timestamp we stamp THAT, so a mark
 * fetched during a long paginated request is not falsely "refreshed" to now, and
 * a market-closed quote stays honestly frozen at the last real quote time. Only
 * when no provider timestamp exists do we fall back to `now`.
 */
export function applyMark(
  position: AutomationPositionDocument,
  mark: number | null,
  now: Date = new Date(),
  providerQuoteTimestamp?: number | null
): void {
  if (mark == null || !Number.isFinite(mark) || position.avgEntryPrice == null) return;
  position.currentMark = mark;
  position.lastMarkAt =
    providerQuoteTimestamp != null && Number.isFinite(providerQuoteTimestamp)
      ? new Date(providerQuoteTimestamp)
      : now;
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
  /** The held contract's provider quote timestamp (ms epoch), if known. */
  markProviderTimestamp?: number | null;
  /** When the mark fetch completed (ms epoch), for freshness diagnostics. */
  markFetchCompletedAt?: number | null;
  /** Computed age of the mark at receipt (ms), for freshness diagnostics. */
  markComputedAgeMs?: number | null;
  /** Freshness threshold in force (ms), for freshness diagnostics. */
  markFreshnessThresholdMs?: number | null;
  /** Where the mark came from (e.g. contract-snapshot / chain / cache). */
  markSource?: string | null;
  /** Cache status for the mark request (HIT / MISS / DEDUP), if known. */
  markCacheStatus?: string | null;
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

  applyMark(position, ctx.currentMark, now, ctx.markProviderTimestamp);

  // Structured freshness diagnostics — the authoritative signal for WHY a mark
  // was (or was not) usable. Age is computed against the DATA's own timestamp,
  // never the loop cadence, so a slow paginated fetch cannot fake staleness and
  // a truly old quote cannot masquerade as fresh.
  const markDiagnostics = {
    symbol: position.optionSymbol,
    providerQuoteTimestamp: ctx.markProviderTimestamp ?? null,
    providerQuoteAt:
      ctx.markProviderTimestamp != null ? new Date(ctx.markProviderTimestamp).toISOString() : null,
    fetchCompletedAt:
      ctx.markFetchCompletedAt != null ? new Date(ctx.markFetchCompletedAt).toISOString() : null,
    computedAgeMs: ctx.markComputedAgeMs ?? null,
    freshnessThresholdMs: ctx.markFreshnessThresholdMs ?? null,
    dataSource: ctx.markSource ?? null,
    cacheStatus: ctx.markCacheStatus ?? null,
    lastMarkAt: position.lastMarkAt?.toISOString() ?? null,
  };
  if (ctx.currentMark == null) {
    logAutomationEvent({
      service: 'position',
      event: 'MONITOR_MARK_MISSING',
      severity: 'warning',
      automationSessionId: position.automationSessionId,
      symbol: position.optionSymbol,
      payload: markDiagnostics,
    });
  } else if (ctx.quoteStale) {
    logAutomationEvent({
      service: 'position',
      event: 'MONITOR_MARK_STALE',
      severity: 'warning',
      automationSessionId: position.automationSessionId,
      symbol: position.optionSymbol,
      payload: markDiagnostics,
    });
  } else {
    logAutomationEvent({
      service: 'position',
      event: 'MONITOR_MARK_FRESH',
      severity: 'info',
      automationSessionId: position.automationSessionId,
      symbol: position.optionSymbol,
      payload: markDiagnostics,
    });
  }

  // Data outage: never invent a mark. Suppress price triggers, raise a warning,
  // keep reconciling. (Entry blocking is handled by the scheduler.) Retained for
  // backward-compatible alerting alongside the richer MONITOR_MARK_* events.
  if (ctx.quoteStale || ctx.currentMark == null) {
    logAutomationEvent({
      service: 'position',
      event: 'MONITOR_QUOTE_STALE',
      severity: 'warning',
      automationSessionId: position.automationSessionId,
      symbol: position.optionSymbol,
      payload: { reason: REASON.MONITOR_QUOTE_STALE, ...markDiagnostics },
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
 * Retry a recovery exit that was parked in MANUAL_REVIEW only because every
 * prior attempt failed before Alpaca acknowledged an exit order. This is a
 * narrow operator/recovery path, not a generic MANUAL_REVIEW escape hatch.
 */
export async function retryManualReviewRecoveryExit(
  positionId: string,
  adapter: PaperBrokerAdapter,
  now: Date = new Date()
): Promise<{ intent: OrderIntentDocument; closed: boolean }> {
  const position = await AutomationPositionModel.findById(positionId);
  if (!position) throw new Error(`position ${positionId} not found`);
  const nothingWorkingAtBroker = position.exitBrokerOrderId == null && (position.exitFilledQty ?? 0) === 0;
  const retryable =
    position.status === 'MANUAL_REVIEW' &&
    position.overnightRecoveryRequired &&
    position.exitReason === 'OVERNIGHT_RECOVERY' &&
    nothingWorkingAtBroker &&
    String(position.manualReviewReason ?? '').includes(REASON.EXIT_RETRIES_EXHAUSTED);
  if (!retryable) {
    throw new Error(`position ${positionId} is not a retryable overnight recovery failure`);
  }

  const nextAttempt = Math.max(0, position.exitAttemptCount ?? 0) + 1;
  const claim = await AutomationPositionModel.updateOne(
    {
      _id: position._id,
      status: 'MANUAL_REVIEW',
      overnightRecoveryRequired: true,
      exitReason: 'OVERNIGHT_RECOVERY',
      exitBrokerOrderId: null,
      exitFilledQty: 0,
    },
    {
      $set: {
        status: 'EXITING',
        exitAttemptCount: nextAttempt,
        exitFilledQty: 0,
        manualReviewReason: null,
      },
    }
  );
  if (claim.modifiedCount !== 1) {
    throw new Error(`position ${positionId} recovery retry was already claimed`);
  }

  position.status = 'EXITING';
  position.exitAttemptCount = nextAttempt;
  position.exitFilledQty = 0;
  position.manualReviewReason = null;

  logAutomationEvent({
    service: 'position',
    event: 'MANUAL_REVIEW_RECOVERY_RETRY_CLAIMED',
    severity: 'warning',
    automationSessionId: position.automationSessionId,
    symbol: position.optionSymbol,
    payload: { reason: 'OVERNIGHT_RECOVERY', attempt: nextAttempt },
  });

  return placeExitOrder(position, adapter, 'OVERNIGHT_RECOVERY', now);
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
  // Release the single-position slot: the entry+exit intents' round trip is now
  // complete, so they must no longer count as an open position. Idempotent and
  // never regresses an already-terminal intent. This is what lets the next
  // entry be approved AFTER (and only after) a broker-confirmed close.
  await completeRoundTripIntents(position, now);
  logAutomationEvent({
    service: 'position',
    event: 'POSITION_CLOSED',
    automationSessionId: position.automationSessionId,
    symbol: position.optionSymbol,
    payload: { avgExitPrice: position.avgExitPrice, exitReason: position.exitReason },
  });
}

/**
 * Mark the entry and exit intents COMPLETED once the position is broker-closed.
 * These are the only intents that represent "an open automation position" to
 * the entry gate (SUBMITTED count), so completing them releases the slot. Never
 * regresses an intent already in a terminal state.
 */
async function completeRoundTripIntents(position: AutomationPositionDocument, now: Date): Promise<void> {
  const ids = [position.entryIntentId, position.exitIntentId].filter((id): id is string => Boolean(id));
  if (!ids.length) return;
  await OrderIntentModel.updateMany(
    { _id: { $in: ids }, status: { $nin: ['BROKER_REJECTED', 'FAILED', 'MANUAL_REVIEW', 'COMPLETED'] } },
    { $set: { status: 'COMPLETED', completedAt: now } }
  );
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

/**
 * Terminate an EXITING position as RECOVERY_FAILED — the deterministic
 * recovery-exhausted state. Preserves ALL history (never deletes), leaves the
 * broker position untouched, and releases the entry-gate slot so the engine can
 * resume evaluating new opportunities. It does this by marking the round-trip
 * intents terminal (the documented slot-release mechanism): the failed recovery
 * EXIT orders → FAILED, and the ENTRY order → COMPLETED (its order lifecycle is
 * genuinely done — it filled). A RECOVERY_FAILED position is excluded from every
 * live-management query, so the scheduler ignores it for concurrency and never
 * touches it again. Idempotent.
 */
async function escalateExitToRecoveryFailed(
  position: AutomationPositionDocument,
  reasonCode: string,
  detail: string,
  now: Date
): Promise<ReconcileExitResult> {
  const claim = await AutomationPositionModel.updateOne(
    { _id: position._id, status: 'EXITING' },
    { $set: { status: 'RECOVERY_FAILED', manualReviewReason: `${reasonCode}: ${detail}`, lastBrokerReconciledAt: now } }
  );
  if (claim.modifiedCount !== 1) return { closed: false, escalated: false, retried: false };
  position.status = 'RECOVERY_FAILED';
  position.manualReviewReason = `${reasonCode}: ${detail}`;

  // Release the entry-gate slot WITHOUT deleting data. The dead recovery EXIT
  // attempts for this contract become terminal failures; the ENTRY order (which
  // filled) becomes COMPLETED. This drops both the concurrency (SUBMITTED) and
  // unresolved-order (SUBMITTING/…) counts to zero for this position.
  await OrderIntentModel.updateMany(
    {
      automationSessionId: position.automationSessionId,
      optionSymbol: position.optionSymbol,
      intentType: 'EXIT',
      status: { $nin: ['BROKER_REJECTED', 'FAILED', 'MANUAL_REVIEW', 'COMPLETED'] },
    },
    { $set: { status: 'FAILED', rejectionReason: `${reasonCode}: ${detail}`, completedAt: now } }
  );
  if (position.entryIntentId) {
    await OrderIntentModel.updateOne(
      { _id: position.entryIntentId, status: { $nin: ['BROKER_REJECTED', 'FAILED', 'MANUAL_REVIEW', 'COMPLETED'] } },
      { $set: { status: 'COMPLETED', completedAt: now } }
    );
  }

  logAutomationEvent({
    service: 'position',
    event: 'POSITION_RECOVERY_FAILED',
    severity: 'critical',
    automationSessionId: position.automationSessionId,
    symbol: position.optionSymbol,
    payload: {
      reason: reasonCode,
      detail,
      exitAttemptCount: position.exitAttemptCount,
      exitBrokerOrderId: position.exitBrokerOrderId,
      note: 'terminal, non-blocking; broker position (if any) untouched and Portfolio-display only',
    },
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
    const detail = `exit failed after ${position.exitAttemptCount} attempt(s) (${reasonCode})`;
    // Deterministic split: when the recovery is exhausted AND nothing is left
    // working at the broker (no acknowledged exit order, no partial exit fill),
    // this is RECOVERY_FAILED — terminal, audit-preserving, and NON-blocking so
    // the engine is never frozen forever by a dead recovery. Otherwise (a
    // partial fill or a still-acknowledged exit order exists) it stays
    // MANUAL_REVIEW: a human must resolve the over-sell / working-order risk.
    const nothingWorkingAtBroker = position.exitBrokerOrderId == null && (position.exitFilledQty ?? 0) === 0;
    if (nothingWorkingAtBroker) {
      return escalateExitToRecoveryFailed(position, REASON.EXIT_RETRIES_EXHAUSTED, detail, now);
    }
    return escalateExitToManualReview(position, REASON.EXIT_RETRIES_EXHAUSTED, detail, now);
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
