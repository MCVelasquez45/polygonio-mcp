import { REASON } from '../automation.config';
import type { BrokerOrder, BrokerOrderStatus } from '../automation.types';
import { AutomationPositionModel } from '../models/automationPosition.model';
import { AutomationSessionModel } from '../models/automationSession.model';
import { BrokerOrderModel, type BrokerOrderDocument } from '../models/brokerOrder.model';
import { OrderIntentModel, type OrderIntentDocument } from '../models/orderIntent.model';
import { UniverseEvaluationModel } from '../models/universeEvaluation.model';
import type { SignalDirection } from '../models/tradeCandidate.model';
import { logAutomationEvent } from './automationAudit.service';
import { recordBrokerOrderSnapshot } from './orderIntent.service';
import { openOrUpdateEntryPosition, type EntryLinks } from './positionManager.service';

// Phase 2C Sprint 3 — broker-truth update ingestion.
//
//   broker update (stream or REST) → classify vs persisted truth → persist the
//   fresher broker snapshot → update the intent lifecycle → reconcile the
//   confirmed filled quantity into ONE durable automation position → STOP.
//
// Only Alpaca broker truth flows through here. It reuses the existing sole
// broker-order writer (recordBrokerOrderSnapshot) and the existing position
// upsert (openOrUpdateEntryPosition) — no parallel journal, no second position
// system. This layer's job is the MONOTONIC, IDEMPOTENT, out-of-order-safe gate
// in front of them, plus contradiction → MANUAL_REVIEW.
//
// It does NOT implement exits, stops/targets, P&L, or risk counters (Sprint 4).

export const TERMINAL_BROKER_STATES: ReadonlySet<BrokerOrderStatus> = new Set<BrokerOrderStatus>([
  'FILLED',
  'CANCELLED',
  'REJECTED',
  'EXPIRED',
  'REPLACED',
]);

// Non-terminal progression rank (higher = more advanced). Terminal states are
// handled separately (a change between two different terminals is a contradiction).
const NON_TERMINAL_RANK: Record<string, number> = {
  CREATED: 0,
  SUBMITTING: 1,
  UNKNOWN: 1,
  PENDING_NEW: 2,
  ACCEPTED: 3,
  CANCEL_PENDING: 4,
  PARTIALLY_FILLED: 5,
};

export type BrokerTransition = 'FRESH' | 'STALE' | 'DUPLICATE' | 'CONTRADICTION';

/**
 * Classify an incoming broker update against the persisted broker-order truth.
 * Pure and deterministic — the monotonic guarantee lives here.
 *
 *  - DUPLICATE: same (status, cumulative filledQty) → idempotent no-op.
 *  - CONTRADICTION: two DIFFERENT terminal states (e.g. FILLED then REJECTED,
 *    or CANCELLED then FILLED) → MANUAL_REVIEW.
 *  - STALE: lower cumulative fill, or a terminal state regressing to non-terminal,
 *    or a lower non-terminal rank → recorded for audit, never regresses truth.
 *  - FRESH: a genuine forward advance → apply.
 */
export function classifyBrokerTransition(
  existing: Pick<BrokerOrderDocument, 'status' | 'filledQty'> | null,
  incoming: Pick<BrokerOrder, 'status' | 'filledQty'>
): BrokerTransition {
  if (!existing) return 'FRESH';

  const wasTerminal = TERMINAL_BROKER_STATES.has(existing.status);
  const isTerminal = TERMINAL_BROKER_STATES.has(incoming.status);

  if (existing.status === incoming.status && incoming.filledQty === existing.filledQty) return 'DUPLICATE';

  // REPLACED is a lineage-continues terminal, not a final one: the replacement
  // order's updates supersede it (never a contradiction), and cumulative fill is
  // still guarded monotonically below.
  if (existing.status === 'REPLACED') {
    return incoming.filledQty < existing.filledQty ? 'STALE' : 'FRESH';
  }

  // Two different terminal states = an irreconcilable contradiction.
  if (wasTerminal && isTerminal && existing.status !== incoming.status) return 'CONTRADICTION';

  // Cumulative fill can never decrease.
  if (incoming.filledQty < existing.filledQty) return 'STALE';

  // A terminal order cannot regress to a non-terminal state.
  if (wasTerminal && !isTerminal) return 'STALE';

  // Among non-terminals with equal fill, a lower progression rank is stale.
  if (!wasTerminal && !isTerminal && incoming.filledQty === existing.filledQty) {
    const nextRank = NON_TERMINAL_RANK[incoming.status] ?? 0;
    const curRank = NON_TERMINAL_RANK[existing.status] ?? 0;
    if (nextRank < curRank) return 'STALE';
    if (nextRank === curRank) return 'DUPLICATE';
  }

  return 'FRESH';
}

/** Direction from the OCC option symbol (…YYMMDD[C|P]strike). */
function directionFromOptionSymbol(optionSymbol: string): SignalDirection {
  const m = optionSymbol.toUpperCase().replace(/^O:/, '').match(/\d{6}([CP])\d{8}$/);
  return m && m[1] === 'P' ? 'BEARISH' : 'BULLISH';
}

/** Resolve the full lifecycle lineage for a position (best-effort, never fatal). */
async function resolveEntryLinks(intent: OrderIntentDocument): Promise<EntryLinks> {
  const base: EntryLinks = {
    automationSessionId: intent.automationSessionId,
    strategyVersionId: intent.strategyVersionId,
    universeEvaluationId: null,
    tradeCandidateId: null,
    contractSelectionId: null,
    riskDecisionId: null,
    underlying: intent.underlying,
    optionSymbol: intent.optionSymbol ?? intent.underlying,
    direction: directionFromOptionSymbol(intent.optionSymbol ?? intent.underlying),
  };
  const evaluation = await UniverseEvaluationModel.findOne({ orderIntentId: String(intent._id) }).lean().catch(() => null);
  if (evaluation) {
    base.universeEvaluationId = String(evaluation._id);
    base.tradeCandidateId = evaluation.selectedCandidateId ?? null;
    const ranked = evaluation.ranking?.find(r => r.symbol === base.underlying);
    if (ranked?.direction) base.direction = ranked.direction;
  }
  return base;
}

export type IngestSource = 'order-poll' | 'reconciliation' | 'stream' | 'submit-response';

export type IngestResult = {
  processed: boolean;
  transition: BrokerTransition | 'IGNORED_NO_INTENT';
  intentId: string | null;
  brokerOrderId: string;
  brokerStatus: BrokerOrderStatus | null;
  positionId: string | null;
  manualReview: boolean;
};

/** Map an internal snapshot source onto the broker-order journal's source enum. */
function journalSource(source: IngestSource): BrokerOrderDocument['lastSource'] {
  return source === 'stream' ? 'order-poll' : source === 'submit-response' ? 'submit-response' : source === 'order-poll' ? 'order-poll' : 'reconciliation';
}

/**
 * Ingest ONE broker order update. Idempotent, monotonic, out-of-order safe.
 * Creates/updates at most one automation position from confirmed filled qty.
 */
export async function ingestBrokerOrderUpdate(order: BrokerOrder, source: IngestSource): Promise<IngestResult> {
  const result: IngestResult = {
    processed: false,
    transition: 'IGNORED_NO_INTENT',
    intentId: null,
    brokerOrderId: order.brokerOrderId,
    brokerStatus: null,
    positionId: null,
    manualReview: false,
  };

  // 1. Identify the automation order by client-order id and/or broker-order id.
  const intent =
    (order.clientOrderId ? await OrderIntentModel.findOne({ clientOrderId: order.clientOrderId }) : null) ??
    (order.brokerOrderId ? await OrderIntentModel.findOne({ brokerOrderId: order.brokerOrderId }) : null);
  if (!intent) {
    // No durable automation linkage → NOT an automation order. Never claimed.
    return result;
  }
  result.intentId = String(intent._id);

  const existing = await BrokerOrderModel.findOne({ brokerOrderId: order.brokerOrderId }).lean();
  // Match by client-order id when the broker-order id is new (e.g. REPLACED lineage).
  const existingByClient =
    existing ?? (order.clientOrderId ? await BrokerOrderModel.findOne({ clientOrderId: order.clientOrderId }).lean() : null);
  const transition = classifyBrokerTransition(existingByClient, order);
  result.transition = transition;

  // 2. Load the session (for MANUAL_REVIEW escalation / links).
  const session = await AutomationSessionModel.findById(intent.automationSessionId);

  if (transition === 'DUPLICATE') {
    // Idempotent no-op: no double-count, no duplicate audit, no second position.
    result.brokerStatus = (existingByClient?.status ?? order.status) as BrokerOrderStatus;
    result.processed = false;
    return result;
  }

  if (transition === 'CONTRADICTION') {
    await BrokerOrderModel.updateOne(
      { brokerOrderId: existingByClient!.brokerOrderId },
      {
        $set: { status: 'MANUAL_REVIEW', lastSource: 'manual-review', lastBrokerUpdateAt: order.updatedAt ?? new Date() },
        $push: { statusHistory: { at: new Date(), status: order.status, rawStatus: order.rawStatus, source: `contradiction:${source}` } },
      }
    );
    if (intent.status !== 'MANUAL_REVIEW') {
      intent.status = 'MANUAL_REVIEW';
      intent.rejectionReason = `contradictory terminal broker states: ${existingByClient!.status} vs ${order.status}`;
      await intent.save();
    }
    logAutomationEvent({
      service: 'broker-ingestion',
      event: 'BROKER_STATE_CONTRADICTION',
      severity: 'critical',
      automationSessionId: intent.automationSessionId,
      intentId: String(intent._id),
      brokerOrderId: order.brokerOrderId,
      payload: { existing: existingByClient!.status, incoming: order.status, reason: REASON.CLOCK_CONFLICT },
    });
    result.manualReview = true;
    result.brokerStatus = 'MANUAL_REVIEW';
    result.processed = true;
    return result;
  }

  if (transition === 'STALE') {
    // Record the stale event for the audit trail but never regress truth.
    if (existingByClient) {
      await BrokerOrderModel.updateOne(
        { brokerOrderId: existingByClient.brokerOrderId },
        { $push: { statusHistory: { at: new Date(), status: order.status, rawStatus: order.rawStatus, source: `stale:${source}` } } }
      );
    }
    logAutomationEvent({
      service: 'broker-ingestion',
      event: 'BROKER_UPDATE_STALE_IGNORED',
      automationSessionId: intent.automationSessionId,
      intentId: String(intent._id),
      brokerOrderId: order.brokerOrderId,
      payload: { incoming: order.status, incomingFilled: order.filledQty, persisted: existingByClient?.status },
    });
    result.brokerStatus = (existingByClient?.status ?? order.status) as BrokerOrderStatus;
    result.processed = false;
    return result;
  }

  // ---- FRESH: persist the newer broker snapshot (the sole writer) ----------
  const journaled = await recordBrokerOrderSnapshot(order, {
    source: journalSource(source),
    intentId: String(intent._id),
    automationSessionId: intent.automationSessionId,
  });
  result.brokerStatus = journaled.status;

  // 8. Update the order-intent lifecycle (monotonic; terminals never regress).
  await updateIntentLifecycle(intent, order);

  // 9. Reconcile the position when confirmed filled quantity > 0 (ENTRY only).
  if (intent.intentType === 'ENTRY' && order.filledQty > 0) {
    const links = await resolveEntryLinks(intent);
    const position = await openOrUpdateEntryPosition(intent, order, links);
    result.positionId = String(position._id);
  }

  logAutomationEvent({
    service: 'broker-ingestion',
    event: 'BROKER_UPDATE_APPLIED',
    automationSessionId: intent.automationSessionId,
    intentId: String(intent._id),
    brokerOrderId: order.brokerOrderId,
    symbol: order.symbol,
    payload: {
      status: journaled.status,
      filledQty: order.filledQty,
      orderedQty: order.qty,
      remainingQty: Math.max(0, order.qty - order.filledQty),
      avgFillPrice: order.avgFillPrice,
      positionId: result.positionId,
      source,
    },
  });
  void session;
  result.processed = true;
  return result;
}

/** Intent lifecycle from broker truth. Terminal intents are never regressed. */
async function updateIntentLifecycle(intent: OrderIntentDocument, order: BrokerOrder): Promise<void> {
  const terminalIntent = ['BROKER_REJECTED', 'FAILED', 'COMPLETED', 'MANUAL_REVIEW'];
  if (terminalIntent.includes(intent.status)) return;

  let next = intent.status;
  if (order.status === 'REJECTED') next = 'BROKER_REJECTED';
  else if ((order.status === 'CANCELLED' || order.status === 'EXPIRED') && order.filledQty === 0) next = 'FAILED';
  else if (order.brokerOrderId && intent.status !== 'SUBMITTED') next = 'SUBMITTED';

  if (next !== intent.status || (order.brokerOrderId && !intent.brokerOrderId)) {
    intent.status = next;
    if (order.brokerOrderId) intent.brokerOrderId = order.brokerOrderId;
    if (order.status === 'REJECTED') intent.rejectionReason = order.rawStatus?.slice(0, 200) ?? 'rejected';
    intent.lastReconciledAt = new Date();
    await intent.save();
  }
}
