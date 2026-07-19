import mongoose from 'mongoose';
import { getExecutionConfig, REASON } from '../automation.config';
import { AutomationSessionModel, RUNNABLE_SESSION_STATUSES } from '../models/automationSession.model';
import { BrokerOrderModel } from '../models/brokerOrder.model';
import { OrderIntentModel } from '../models/orderIntent.model';
import { logAutomationEvent } from './automationAudit.service';
import { ingestBrokerOrderUpdate, TERMINAL_BROKER_STATES } from './brokerUpdateIngestion.service';
import type { PaperBrokerAdapter } from './brokerAdapter';
import type { MarketSessionState } from './marketSession.service';
import { isBrokerTruthCurrent } from './orderReconciliation.service';
import { submitIntent } from './orderIntent.service';
import { isAutomationReady } from './sessionRecovery.service';

// Phase 2C Sprint 2 — wire an Approved Order Intent to the broker.
//
//   Approved Order Intent → [8 pre-submission gates] → submitIntent()
//   → PaperBrokerAdapter → Alpaca paper → broker acknowledgement
//   → persisted (broker-order journal, by submitIntent) → STOP.
//
// This layer adds NO new broker path and NO new persistence: it reuses the
// existing submitIntent (persist-then-act, idempotent client_order_id, broker
// journal via recordBrokerOrderSnapshot). Its only additions are the explicit
// pre-submission verification and the sprint rule that ANY ambiguity escalates
// the intent to MANUAL_REVIEW (never a blind retry). It does NOT process fills,
// create positions, compute P&L, or touch risk counters — those are Sprint 3+.

export type SubmissionContext = {
  /** The scheduler owns the lease this tick. */
  ownsLease: boolean;
  /** Authoritative market phase; entries only when open + before cutoff. */
  marketSession: MarketSessionState;
};

export type SubmissionOutcome =
  | 'SUBMITTED'
  | 'ALREADY_SUBMITTED'
  | 'BROKER_REJECTED'
  | 'RECOVERED_FROM_BROKER'
  | 'MANUAL_REVIEW'
  | 'REFUSED';

export type SubmissionResult = {
  intentId: string;
  submitted: boolean;
  outcome: SubmissionOutcome;
  refusedReason: string | null;
  clientOrderId: string | null;
  brokerOrderId: string | null;
  brokerStatus: string | null;
};

export type EntryOrderTimeoutSummary = {
  scanned: number;
  reconciled: number;
  cancelRequested: number;
  alreadyCancelPending: number;
  terminal: number;
  errors: number;
};

function emptyEntryOrderTimeoutSummary(): EntryOrderTimeoutSummary {
  return { scanned: 0, reconciled: 0, cancelRequested: 0, alreadyCancelPending: 0, terminal: 0, errors: 0 };
}

/**
 * Resolve submitted ENTRY intents that have rested past the configured timeout.
 * Broker truth is polled first; terminal/filled states are ingested as-is. Only
 * still-working broker orders receive a cancel request, and the cancel response
 * is folded through the same broker-update ingestion path as reconciliation.
 */
export async function cancelTimedOutEntryOrders(
  adapter: PaperBrokerAdapter,
  now: Date = new Date()
): Promise<EntryOrderTimeoutSummary> {
  const summary = emptyEntryOrderTimeoutSummary();
  const timeoutMs = getExecutionConfig().entryOrderTimeoutSeconds * 1000;
  const cutoff = new Date(now.getTime() - timeoutMs);
  const intents = await OrderIntentModel.find({
    intentType: 'ENTRY',
    status: 'SUBMITTED',
    brokerOrderId: { $ne: null },
    submittedAt: { $ne: null, $lte: cutoff },
  });

  for (const intent of intents) {
    summary.scanned += 1;
    const brokerOrderId = intent.brokerOrderId;
    if (!brokerOrderId) continue;
    try {
      const current = await adapter.getOrder(brokerOrderId);
      await ingestBrokerOrderUpdate(current, 'order-poll');
      summary.reconciled += 1;

      if (TERMINAL_BROKER_STATES.has(current.status)) {
        summary.terminal += 1;
        continue;
      }
      if (current.status === 'CANCEL_PENDING') {
        summary.alreadyCancelPending += 1;
        continue;
      }

      const cancelled = await adapter.cancelOrder(brokerOrderId);
      await ingestBrokerOrderUpdate(cancelled, 'order-poll');
      summary.cancelRequested += 1;
      logAutomationEvent({
        service: 'order-submission',
        event: 'ENTRY_ORDER_TIMEOUT_CANCEL_REQUESTED',
        severity: 'warning',
        automationSessionId: intent.automationSessionId,
        intentId: String(intent._id),
        brokerOrderId,
        symbol: intent.optionSymbol ?? intent.underlying,
        payload: {
          reason: REASON.ENTRY_ORDER_TIMEOUT,
          timeoutSeconds: getExecutionConfig().entryOrderTimeoutSeconds,
          submittedAt: intent.submittedAt?.toISOString() ?? null,
          brokerStatusBeforeCancel: current.status,
          brokerStatusAfterCancel: cancelled.status,
          filledQty: cancelled.filledQty,
        },
      });
    } catch (error: any) {
      summary.errors += 1;
      logAutomationEvent({
        service: 'order-submission',
        event: 'ENTRY_ORDER_TIMEOUT_CANCEL_FAILED',
        severity: 'warning',
        automationSessionId: intent.automationSessionId,
        intentId: String(intent._id),
        brokerOrderId,
        symbol: intent.optionSymbol ?? intent.underlying,
        payload: {
          reason: REASON.ENTRY_ORDER_TIMEOUT,
          message: String(error?.message ?? error).slice(0, 300),
        },
      });
    }
  }

  return summary;
}

/**
 * Submit ONE approved ENTRY intent, enforcing every pre-submission gate. On any
 * ambiguous broker outcome the intent is moved to MANUAL_REVIEW. Idempotent by
 * construction (submitIntent maps one intent to at most one broker order).
 */
export async function submitApprovedIntent(
  intentId: string,
  adapter: PaperBrokerAdapter,
  ctx: SubmissionContext
): Promise<SubmissionResult> {
  const base = (outcome: SubmissionOutcome, refusedReason: string | null, extra: Partial<SubmissionResult> = {}): SubmissionResult => ({
    intentId,
    submitted: outcome === 'SUBMITTED' || outcome === 'ALREADY_SUBMITTED' || outcome === 'RECOVERED_FROM_BROKER',
    outcome,
    refusedReason,
    clientOrderId: extra.clientOrderId ?? null,
    brokerOrderId: extra.brokerOrderId ?? null,
    brokerStatus: extra.brokerStatus ?? null,
  });

  const refuse = (reason: string): SubmissionResult => {
    logAutomationEvent({
      service: 'order-submission',
      event: 'SUBMISSION_REFUSED',
      severity: 'warning',
      intentId,
      payload: { reason },
    });
    return base('REFUSED', reason);
  };

  // Gate 1 — Automation READY (Mongo up + startup reconciliation succeeded).
  if (mongoose.connection?.readyState !== 1 || !isAutomationReady()) return refuse('AUTOMATION_NOT_READY');
  // Gate 2 — Scheduler lease owned by this tick.
  if (!ctx.ownsLease) return refuse('SCHEDULER_LEASE_NOT_OWNED');
  // Gate 3/4 — Market open AND before the entry cutoff.
  if (!ctx.marketSession.isOpen) return refuse('MARKET_CLOSED');
  if (!ctx.marketSession.entriesAllowed) return refuse('AFTER_FINAL_ENTRY_CUTOFF');
  // Gate — broker truth must be current (stream connected or fresh REST
  // reconciliation). A disconnected stream with stale REST blocks submission.
  if (!isBrokerTruthCurrent()) return refuse('BROKER_TRUTH_STALE');

  const intent = await OrderIntentModel.findById(intentId);
  if (!intent) return refuse('INTENT_NOT_FOUND');
  if (intent.intentType !== 'ENTRY') return refuse('NOT_AN_ENTRY_INTENT');
  // Submittable only from the deterministic pipeline's approved state.
  if (intent.status !== 'APPROVED_AWAITING_EXECUTION' && intent.status !== 'CREATED') {
    return base('ALREADY_SUBMITTED', 'intent not in a submittable state', { clientOrderId: intent.clientOrderId });
  }
  // Gate 8 — No existing broker order for this intent (idempotency guard).
  if (intent.brokerOrderId) return base('ALREADY_SUBMITTED', 'intent already has a broker order', { clientOrderId: intent.clientOrderId, brokerOrderId: intent.brokerOrderId });
  const existingBrokerOrder = await BrokerOrderModel.findOne({ clientOrderId: intent.clientOrderId }).lean();
  if (existingBrokerOrder) {
    return base('ALREADY_SUBMITTED', 'a broker order already exists for this client_order_id', {
      clientOrderId: intent.clientOrderId,
      brokerOrderId: existingBrokerOrder.brokerOrderId,
      brokerStatus: existingBrokerOrder.status,
    });
  }

  const session = await AutomationSessionModel.findById(intent.automationSessionId);
  if (!session) return refuse('SESSION_NOT_FOUND');
  // Gate 5/6 — session runnable, reconciliation CLEAN, no emergency stop.
  if (!RUNNABLE_SESSION_STATUSES.includes(session.status)) return refuse('SESSION_NOT_RUNNABLE');
  if (session.reconciliationStatus !== 'CLEAN') return refuse('RECONCILIATION_NOT_CLEAN');
  if (session.emergencyStop.active) return refuse('EMERGENCY_STOP_ACTIVE');

  // ---- submit through the EXISTING path (persist-then-act + broker journal) --
  const result = await submitIntent(intentId, adapter);

  // Ambiguity → MANUAL_REVIEW. Never a blind retry; parked for an operator.
  if (result.outcome === 'AMBIGUOUS_SUBMIT_FAILURE') {
    const parked = await OrderIntentModel.findById(intentId);
    if (parked && parked.status !== 'MANUAL_REVIEW') {
      parked.status = 'MANUAL_REVIEW';
      parked.rejectionReason = 'ambiguous submit outcome — requires manual reconciliation';
      await parked.save();
    }
    logAutomationEvent({
      service: 'order-submission',
      event: 'SUBMISSION_AMBIGUOUS_MANUAL_REVIEW',
      severity: 'critical',
      automationSessionId: intent.automationSessionId,
      intentId,
      payload: { clientOrderId: intent.clientOrderId, note: 'no blind retry; awaiting reconciliation' },
    });
    return base('MANUAL_REVIEW', 'ambiguous submit', { clientOrderId: intent.clientOrderId });
  }

  logAutomationEvent({
    service: 'order-submission',
    event: 'SUBMISSION_COMPLETE',
    severity: result.outcome === 'BROKER_REJECTED' ? 'warning' : 'info',
    automationSessionId: intent.automationSessionId,
    intentId,
    symbol: intent.optionSymbol ?? intent.underlying,
    payload: {
      outcome: result.outcome,
      brokerOrderId: result.brokerOrder?.brokerOrderId ?? null,
      brokerStatus: result.brokerOrder?.status ?? null,
      note: 'Sprint 2 stops here — no fills, positions, or P&L',
    },
  });

  return base(result.outcome as SubmissionOutcome, null, {
    clientOrderId: intent.clientOrderId,
    brokerOrderId: result.brokerOrder?.brokerOrderId ?? null,
    brokerStatus: result.brokerOrder?.status ?? null,
  });
}
