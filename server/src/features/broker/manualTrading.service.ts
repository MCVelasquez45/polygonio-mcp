import mongoose from 'mongoose';
import {
  ManualOrderIntentModel,
  type ManualOrderIntentDocument,
} from './manualOrderIntent.model';
import {
  authorizeManualSubmission,
  manualClientOrderId,
  orderPayloadHash,
  type ExecutionGateResult,
} from './executionGateway';

// Manual paper-trading lifecycle: CREATE (from a reviewed contract) → CONFIRM
// (explicit user action) → SUBMIT (through the execution gateway → broker). A
// selection creates at most a CREATED intent; nothing here submits without an
// explicit confirm followed by an explicit submit.

export type ManualOrderInput = {
  optionSymbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  orderType: string;
  limitPrice?: number | null;
  timeInForce?: string;
  positionIntent?: string;
  requestedByUserId?: string | null;
  /** Market-data provenance only — never execution authority. */
  marketDataSource?: string | null;
};

/** The normalized, hashable order (broker request shape; excludes client_order_id). */
export function buildManualOrder(input: ManualOrderInput): Record<string, unknown> {
  const symbol = input.optionSymbol.trim().toUpperCase();
  const qty = Number(input.quantity);
  const limit = input.limitPrice != null && Number.isFinite(Number(input.limitPrice)) ? Number(input.limitPrice) : null;
  return {
    legs: [
      {
        symbol,
        qty: 1,
        side: input.side,
        position_intent: input.positionIntent ?? (input.side === 'buy' ? 'buy_to_open' : 'sell_to_close'),
      },
    ],
    quantity: qty,
    order_type: input.orderType,
    order_class: 'simple',
    time_in_force: input.timeInForce ?? 'day',
    limit_price: limit ?? undefined,
  };
}

export async function createManualIntent(input: ManualOrderInput): Promise<ManualOrderIntentDocument> {
  const order = buildManualOrder(input);
  const doc = await ManualOrderIntentModel.create({
    optionSymbol: input.optionSymbol.trim().toUpperCase(),
    side: input.side,
    quantity: Number(input.quantity),
    orderType: input.orderType,
    limitPrice: input.limitPrice != null ? Number(input.limitPrice) : null,
    timeInForce: input.timeInForce ?? 'day',
    order,
    payloadHash: orderPayloadHash(order),
    requestedByUserId: input.requestedByUserId ?? null,
    marketDataSource: input.marketDataSource ?? null,
    status: 'CREATED',
  });
  return doc;
}

export async function confirmManualIntent(intentId: string): Promise<ManualOrderIntentDocument | null> {
  const doc = await ManualOrderIntentModel.findById(intentId);
  if (!doc) return null;
  if (doc.status === 'CREATED') {
    doc.status = 'CONFIRMED';
    doc.confirmedAt = new Date();
    await doc.save();
  }
  return doc;
}

export type ManualGateState = {
  manualTradingEnabled: boolean;
  mongoConnected: boolean;
  clockAvailable: boolean;
};

/** Injected broker submit — the real Alpaca options submit in production. */
export type BrokerSubmit = (order: Record<string, unknown> & { client_order_id: string }) => Promise<any>;

export type ManualSubmitResult = {
  outcome: 'SUBMITTED' | 'ALREADY_SUBMITTED' | 'REJECTED' | 'FAILED';
  rejectionReason: string | null;
  intent: ManualOrderIntentDocument;
  brokerOrder: any | null;
};

/**
 * Submit a CONFIRMED manual intent through the execution gateway. Idempotent:
 * an already-submitted intent returns its existing broker order and never
 * places a second one; concurrent submits are serialized by an atomic
 * CONFIRMED→SUBMITTING claim so a double-click yields exactly one broker order.
 */
export async function submitManualIntent(
  intentId: string,
  deps: { gates: ManualGateState; brokerSubmit: BrokerSubmit; submittedPayloadHash?: string | null }
): Promise<ManualSubmitResult> {
  const existing = await ManualOrderIntentModel.findById(intentId);
  if (!existing) {
    // Represent "not found" as a rejection without a document.
    throw new Error(`Manual order intent ${intentId} not found`);
  }
  // Idempotent re-entry: already placed → return the existing broker order.
  if (existing.status === 'SUBMITTED' && existing.brokerOrderId) {
    return { outcome: 'ALREADY_SUBMITTED', rejectionReason: null, intent: existing, brokerOrder: { id: existing.brokerOrderId, client_order_id: existing.clientOrderId } };
  }

  // Authorize BEFORE claiming — an unconfirmed/ungoverned request never mutates state.
  const payloadUnchanged =
    deps.submittedPayloadHash == null || deps.submittedPayloadHash === existing.payloadHash;
  const clientOrderId = manualClientOrderId(String(existing._id), 1);
  const gate: ExecutionGateResult = authorizeManualSubmission({
    executionMode: existing.executionMode,
    orderSource: existing.orderSource,
    authorizationId: String(existing._id),
    idempotencyKey: clientOrderId,
    confirmed: existing.status === 'CONFIRMED' || existing.status === 'SUBMITTING',
    payloadUnchanged,
    gates: deps.gates,
  });
  if (!gate.authorized) {
    // Record the block but never regress a terminal state.
    if (existing.status === 'CREATED' || existing.status === 'CONFIRMED') {
      existing.status = 'REJECTED';
      existing.rejectionReason = gate.rejectionReason;
      await existing.save();
    }
    return { outcome: 'REJECTED', rejectionReason: gate.rejectionReason, intent: existing, brokerOrder: null };
  }

  // Atomic claim CONFIRMED→SUBMITTING so only one caller reaches the broker.
  const claim = await ManualOrderIntentModel.updateOne(
    { _id: existing._id, status: 'CONFIRMED' },
    { $set: { status: 'SUBMITTING', clientOrderId, attemptCount: 1 } }
  );
  if (claim.modifiedCount !== 1) {
    // Lost the race (or not CONFIRMED). Return the current durable truth.
    const fresh = await ManualOrderIntentModel.findById(intentId);
    if (fresh?.status === 'SUBMITTED' && fresh.brokerOrderId) {
      return { outcome: 'ALREADY_SUBMITTED', rejectionReason: null, intent: fresh, brokerOrder: { id: fresh.brokerOrderId, client_order_id: fresh.clientOrderId } };
    }
    return { outcome: 'ALREADY_SUBMITTED', rejectionReason: null, intent: fresh ?? existing, brokerOrder: null };
  }

  try {
    const brokerOrder = await deps.brokerSubmit({ ...(existing.order as Record<string, unknown>), client_order_id: clientOrderId });
    const brokerOrderId = brokerOrder?.id ?? brokerOrder?.order_id ?? brokerOrder?.brokerOrderId ?? null;
    await ManualOrderIntentModel.updateOne(
      { _id: existing._id },
      { $set: { status: 'SUBMITTED', brokerOrderId, submittedAt: new Date() } }
    );
    const saved = await ManualOrderIntentModel.findById(intentId);
    return { outcome: 'SUBMITTED', rejectionReason: null, intent: saved ?? existing, brokerOrder };
  } catch (error: any) {
    await ManualOrderIntentModel.updateOne(
      { _id: existing._id },
      { $set: { status: 'FAILED', rejectionReason: String(error?.message ?? error).slice(0, 300) } }
    );
    const saved = await ManualOrderIntentModel.findById(intentId);
    return { outcome: 'FAILED', rejectionReason: String(error?.message ?? error).slice(0, 300), intent: saved ?? existing, brokerOrder: null };
  }
}

/** Live gate state for the route (Mongo, clock, operational switch). */
export function manualTradingEnabled(): boolean {
  return (process.env.MANUAL_TRADING_ENABLED ?? 'true').toLowerCase() !== 'false';
}

export function mongoConnected(): boolean {
  return mongoose.connection?.readyState === 1;
}
