import { createHash } from 'crypto';
import mongoose from 'mongoose';
import { CLIENT_ORDER_ID_PREFIX } from '../automation.constants';
import {
  IllegalBrokerStateSourceError,
  MongoUnavailableError,
  NotFoundError,
  SessionNotRunnableError,
} from '../automation.errors';
import type {
  ApprovedOrderIntent,
  BrokerOrder,
  CreateOrderIntentInput,
  IdempotencyKeyInput,
} from '../automation.types';
import {
  AutomationSessionModel,
  RUNNABLE_SESSION_STATUSES,
} from '../models/automationSession.model';
import { BrokerOrderModel, type BrokerOrderDocument } from '../models/brokerOrder.model';
import { OrderIntentModel, type OrderIntentDocument } from '../models/orderIntent.model';
import { logAutomationEvent } from './automationAudit.service';
import type { PaperBrokerAdapter } from './brokerAdapter';
import { assertEntryAllowed } from './marketClock.service';

// Order-intent journal + the ONLY broker-order journal writer.
//
// Safety invariants enforced here:
//  1. An intent is persisted BEFORE any broker call (persist-then-act).
//  2. The idempotency key is derived deterministically; the unique index makes
//     duplicate intents structurally impossible.
//  3. Broker-order states come exclusively from BrokerOrder payloads returned
//     by the adapter — recordBrokerOrderSnapshot rejects anything else.
//  4. Ambiguous submit failures are never auto-retried; they park for
//     reconciliation.

function assertMongoConnected(): void {
  if (mongoose.connection?.readyState !== 1) {
    throw new MongoUnavailableError();
  }
}

function normalizeBarTimestamp(value: string | number | Date): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return new Date(value).toISOString();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? String(value) : new Date(parsed).toISOString();
}

/** Deterministic idempotency key from exactly the six specified inputs. */
export function buildIdempotencyKey(input: IdempotencyKeyInput): string {
  const canonical = [
    input.automationSessionId,
    input.strategyVersionId,
    input.underlying.toUpperCase(),
    input.signalDirection,
    normalizeBarTimestamp(input.closedBarTimestamp),
    input.intentType,
  ].join('|');
  return createHash('sha256').update(canonical).digest('hex');
}

export function buildClientOrderId(idempotencyKey: string): string {
  // Alpaca allows ≤48 chars; prefix + 32 hex chars is deterministic and short.
  return `${CLIENT_ORDER_ID_PREFIX}${idempotencyKey.slice(0, 32)}`;
}

export type CreateIntentResult = {
  intent: OrderIntentDocument;
  created: boolean;
};

/**
 * Create (or return the existing) order intent for a deterministic key.
 * Never creates a broker request. Duplicate keys return the original record.
 */
export async function createOrderIntent(input: CreateOrderIntentInput): Promise<CreateIntentResult> {
  assertMongoConnected();

  const idempotencyKey = buildIdempotencyKey(input);
  const clientOrderId = buildClientOrderId(idempotencyKey);
  const closedBarTimestamp = normalizeBarTimestamp(input.closedBarTimestamp);

  // Atomic upsert: first writer wins, every later caller sees the same doc.
  const intent = await OrderIntentModel.findOneAndUpdate(
    { idempotencyKey },
    {
      $setOnInsert: {
        automationSessionId: input.automationSessionId,
        strategyVersionId: input.strategyVersionId,
        underlying: input.underlying.toUpperCase(),
        optionSymbol: input.optionSymbol ?? null,
        intentType: input.intentType,
        direction: input.signalDirection,
        quantity: input.quantity,
        orderType: input.orderType,
        limitPrice: input.limitPrice ?? null,
        timeInForce: input.timeInForce,
        status: 'CREATED',
        idempotencyKey,
        clientOrderId,
        idempotencyInputs: {
          automationSessionId: input.automationSessionId,
          strategyVersionId: input.strategyVersionId,
          underlying: input.underlying.toUpperCase(),
          signalDirection: input.signalDirection,
          closedBarTimestamp,
          intentType: input.intentType,
        },
        brokerOrderId: null,
        rejectionReason: null,
        attemptCount: 0,
        lastReconciledAt: null,
        submittedAt: null,
        completedAt: null,
      },
    },
    { new: true, upsert: true, includeResultMetadata: true }
  );

  const doc = intent.value as OrderIntentDocument;
  const created = !intent.lastErrorObject?.updatedExisting;

  logAutomationEvent({
    service: 'order-intent',
    event: created ? 'ORDER_INTENT_CREATED' : 'DUPLICATE_INTENT_SUPPRESSED',
    severity: created ? 'info' : 'warning',
    automationSessionId: input.automationSessionId,
    intentId: String(doc._id),
    symbol: input.optionSymbol ?? input.underlying,
    payload: { idempotencyKey, clientOrderId, intentType: input.intentType, status: doc.status },
  });

  return { intent: doc, created };
}

/**
 * The ONLY writer for the broker-order journal.
 *
 * Requires a BrokerOrder produced by a PaperBrokerAdapter (i.e., a broker
 * response). Rejects payloads that lack broker identity/raw status so an
 * internal event can never masquerade as a fill.
 */
export async function recordBrokerOrderSnapshot(
  order: BrokerOrder,
  meta: {
    source: BrokerOrderDocument['lastSource'];
    intentId?: string | null;
    automationSessionId?: string | null;
  }
): Promise<BrokerOrderDocument> {
  assertMongoConnected();

  if (!order || typeof order !== 'object' || !order.brokerOrderId || !order.rawStatus) {
    throw new IllegalBrokerStateSourceError(
      'payload is missing brokerOrderId/rawStatus — only adapter-returned broker responses are accepted'
    );
  }
  const validSources: BrokerOrderDocument['lastSource'][] = [
    'submit-response',
    'order-poll',
    'reconciliation',
    'manual-review',
  ];
  if (!validSources.includes(meta.source)) {
    throw new IllegalBrokerStateSourceError(`invalid snapshot source '${String(meta.source)}'`);
  }

  const now = new Date();
  const existing = await BrokerOrderModel.findOne({ brokerOrderId: order.brokerOrderId });
  if (!existing) {
    return BrokerOrderModel.create({
      brokerOrderId: order.brokerOrderId,
      clientOrderId: order.clientOrderId,
      intentId: meta.intentId ?? null,
      automationSessionId: meta.automationSessionId ?? null,
      symbol: order.symbol,
      side: order.side,
      qty: order.qty,
      filledQty: order.filledQty,
      avgFillPrice: order.avgFillPrice,
      status: order.status,
      rawStatus: order.rawStatus,
      orderType: order.orderType,
      limitPrice: order.limitPrice,
      timeInForce: order.timeInForce,
      lastSource: meta.source,
      submittedAt: order.submittedAt,
      lastBrokerUpdateAt: order.updatedAt ?? now,
      statusHistory: [{ at: now, status: order.status, rawStatus: order.rawStatus, source: meta.source }],
    });
  }

  const statusChanged = existing.status !== order.status || existing.filledQty !== order.filledQty;
  existing.clientOrderId = order.clientOrderId ?? existing.clientOrderId;
  existing.intentId = meta.intentId ?? existing.intentId;
  existing.automationSessionId = meta.automationSessionId ?? existing.automationSessionId;
  existing.filledQty = order.filledQty;
  existing.avgFillPrice = order.avgFillPrice;
  existing.status = order.status;
  existing.rawStatus = order.rawStatus;
  existing.lastSource = meta.source;
  existing.lastBrokerUpdateAt = order.updatedAt ?? now;
  if (statusChanged) {
    existing.statusHistory.push({ at: now, status: order.status, rawStatus: order.rawStatus, source: meta.source });
  }
  await existing.save();
  return existing;
}

export type SubmitIntentResult = {
  intent: OrderIntentDocument;
  brokerOrder: BrokerOrder | null;
  outcome:
    | 'SUBMITTED'
    | 'ALREADY_SUBMITTED'
    | 'BROKER_REJECTED'
    | 'AMBIGUOUS_SUBMIT_FAILURE'
    | 'RECOVERED_FROM_BROKER';
};

/**
 * Guarded submission path. Phase 2A: reachable only from tests and explicit
 * operator action — NOTHING wires market signals into this function.
 *
 * Guarantees:
 *  - a given intent produces at most one broker order, across retries and
 *    restarts (client_order_id = f(idempotencyKey));
 *  - repeated calls after submission re-poll the existing broker order instead
 *    of resubmitting;
 *  - a submit that fails ambiguously (e.g. timeout) leaves the intent in
 *    SUBMITTING for reconciliation — it is never blindly retried.
 */
export async function submitIntent(
  intentId: string,
  adapter: PaperBrokerAdapter
): Promise<SubmitIntentResult> {
  assertMongoConnected();

  const intent = await OrderIntentModel.findById(intentId);
  if (!intent) throw new NotFoundError(`Order intent ${intentId}`);

  const session = await AutomationSessionModel.findById(intent.automationSessionId);
  if (!session) throw new NotFoundError(`Automation session ${intent.automationSessionId}`);
  if (!RUNNABLE_SESSION_STATUSES.includes(session.status) || session.emergencyStop.active) {
    throw new SessionNotRunnableError(String(session._id), session.status);
  }

  // Entries are clock-gated; exits are always allowed to reduce risk.
  if (intent.intentType === 'ENTRY') {
    await assertEntryAllowed(adapter);
  }

  // Idempotent re-entry: intent already tied to a broker order → poll, never resubmit.
  if (intent.status === 'SUBMITTED' && intent.brokerOrderId) {
    const order = await adapter.getOrder(intent.brokerOrderId);
    await recordBrokerOrderSnapshot(order, {
      source: 'order-poll',
      intentId: String(intent._id),
      automationSessionId: intent.automationSessionId,
    });
    return { intent, brokerOrder: order, outcome: 'ALREADY_SUBMITTED' };
  }

  // Ambiguous prior attempt: resolve against the broker before anything else.
  if (intent.status === 'SUBMITTING') {
    const existing = await adapter.getOrderByClientOrderId(intent.clientOrderId);
    if (existing) {
      intent.status = existing.status === 'REJECTED' ? 'BROKER_REJECTED' : 'SUBMITTED';
      intent.brokerOrderId = existing.brokerOrderId;
      intent.lastReconciledAt = new Date();
      await intent.save();
      await recordBrokerOrderSnapshot(existing, {
        source: 'reconciliation',
        intentId: String(intent._id),
        automationSessionId: intent.automationSessionId,
      });
      logAutomationEvent({
        service: 'order-intent',
        event: 'INTENT_RECOVERED_FROM_BROKER',
        automationSessionId: intent.automationSessionId,
        intentId: String(intent._id),
        brokerOrderId: existing.brokerOrderId,
        payload: { clientOrderId: intent.clientOrderId, brokerStatus: existing.status },
      });
      return { intent, brokerOrder: existing, outcome: 'RECOVERED_FROM_BROKER' };
    }
    // Not at the broker and prior attempt state is ambiguous: park it.
    logAutomationEvent({
      service: 'order-intent',
      event: 'AMBIGUOUS_SUBMIT_STATE',
      severity: 'warning',
      automationSessionId: intent.automationSessionId,
      intentId: String(intent._id),
      payload: { clientOrderId: intent.clientOrderId, note: 'left in SUBMITTING for reconciliation' },
    });
    return { intent, brokerOrder: null, outcome: 'AMBIGUOUS_SUBMIT_FAILURE' };
  }

  if (intent.status !== 'CREATED') {
    // Terminal-ish intents are never resubmitted.
    return { intent, brokerOrder: null, outcome: 'ALREADY_SUBMITTED' };
  }

  // Persist-then-act: mark SUBMITTING durably before touching the broker.
  intent.status = 'SUBMITTING';
  intent.attemptCount += 1;
  await intent.save();

  const approved: ApprovedOrderIntent = {
    intentId: String(intent._id),
    idempotencyKey: intent.idempotencyKey,
    clientOrderId: intent.clientOrderId,
    symbol: intent.optionSymbol ?? intent.underlying,
    side: intent.direction,
    quantity: intent.quantity,
    orderType: intent.orderType,
    limitPrice: intent.limitPrice,
    timeInForce: intent.timeInForce,
    intentType: intent.intentType,
  };

  let order: BrokerOrder;
  try {
    order = await adapter.submitOrder(approved);
  } catch (error) {
    // Ambiguous: the broker may or may not have received it. One resolve
    // attempt by client_order_id; otherwise leave SUBMITTING for reconciliation.
    logAutomationEvent({
      service: 'order-intent',
      event: 'BROKER_SUBMIT_FAILED',
      severity: 'warning',
      automationSessionId: intent.automationSessionId,
      intentId: String(intent._id),
      payload: { message: (error as Error)?.message?.slice(0, 300), attemptCount: intent.attemptCount },
    });
    try {
      const existing = await adapter.getOrderByClientOrderId(intent.clientOrderId);
      if (existing) {
        intent.status = existing.status === 'REJECTED' ? 'BROKER_REJECTED' : 'SUBMITTED';
        intent.brokerOrderId = existing.brokerOrderId;
        intent.submittedAt = new Date();
        await intent.save();
        await recordBrokerOrderSnapshot(existing, {
          source: 'reconciliation',
          intentId: String(intent._id),
          automationSessionId: intent.automationSessionId,
        });
        return { intent, brokerOrder: existing, outcome: 'RECOVERED_FROM_BROKER' };
      }
    } catch {
      // resolve attempt failed too — stay ambiguous
    }
    return { intent, brokerOrder: null, outcome: 'AMBIGUOUS_SUBMIT_FAILURE' };
  }

  await recordBrokerOrderSnapshot(order, {
    source: 'submit-response',
    intentId: String(intent._id),
    automationSessionId: intent.automationSessionId,
  });

  if (order.status === 'REJECTED') {
    intent.status = 'BROKER_REJECTED';
    intent.rejectionReason = order.rawStatus;
    intent.brokerOrderId = order.brokerOrderId;
    intent.submittedAt = new Date();
    await intent.save();
    logAutomationEvent({
      service: 'order-intent',
      event: 'ORDER_REJECTED_BY_BROKER',
      severity: 'warning',
      automationSessionId: intent.automationSessionId,
      intentId: String(intent._id),
      brokerOrderId: order.brokerOrderId,
      payload: { rawStatus: order.rawStatus },
    });
    return { intent, brokerOrder: order, outcome: 'BROKER_REJECTED' };
  }

  intent.status = 'SUBMITTED';
  intent.brokerOrderId = order.brokerOrderId;
  intent.submittedAt = new Date();
  await intent.save();
  logAutomationEvent({
    service: 'order-intent',
    event: 'ORDER_SUBMITTED',
    automationSessionId: intent.automationSessionId,
    intentId: String(intent._id),
    brokerOrderId: order.brokerOrderId,
    symbol: order.symbol,
    payload: { clientOrderId: intent.clientOrderId, brokerStatus: order.status },
  });
  return { intent, brokerOrder: order, outcome: 'SUBMITTED' };
}

export async function listSessionIntents(automationSessionId: string, limit = 100) {
  return OrderIntentModel.find({ automationSessionId })
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 500))
    .lean();
}

export async function listSessionBrokerOrders(automationSessionId: string, limit = 100) {
  return BrokerOrderModel.find({ automationSessionId })
    .sort({ updatedAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 500))
    .lean();
}
