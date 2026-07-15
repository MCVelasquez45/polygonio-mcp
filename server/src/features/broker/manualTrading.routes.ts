import { Router } from 'express';
import { logAutomationEvent } from '../automation/services/automationAudit.service';
import { getAlpacaClock, submitAlpacaOptionsOrder } from './services/alpaca';
import { orderPayloadHash } from './executionGateway';
import {
  confirmManualIntent,
  createManualIntent,
  manualTradingEnabled,
  mongoConnected,
  submitManualIntent,
  type ManualGateState,
} from './manualTrading.service';

// Manual paper-trading API — the ONLY user-driven execution surface. Distinct
// from research (read-only) and automation (deterministic engine). Every
// submission passes the execution gateway (see manualTrading.service).

const router = Router();

/** Live infrastructure gate state (fail closed on anything unhealthy). */
async function gatherGates(): Promise<ManualGateState> {
  let clockAvailable = false;
  try {
    await getAlpacaClock();
    clockAvailable = true;
  } catch {
    clockAvailable = false;
  }
  return {
    manualTradingEnabled: manualTradingEnabled(),
    mongoConnected: mongoConnected(),
    clockAvailable,
  };
}

// POST /api/trading/manual/intents — create a manual intent from a reviewed
// contract. This is NOT a submission; it only records a durable draft.
router.post('/intents', async (req, res, next) => {
  try {
    const b = req.body ?? {};
    if (!b.optionSymbol || !b.side || !b.quantity || !b.orderType) {
      return res.status(400).json({ error: 'optionSymbol, side, quantity, orderType are required' });
    }
    const intent = await createManualIntent({
      optionSymbol: String(b.optionSymbol),
      side: b.side === 'sell' ? 'sell' : 'buy',
      quantity: Number(b.quantity),
      orderType: String(b.orderType),
      limitPrice: b.limitPrice ?? b.limit_price ?? null,
      timeInForce: b.timeInForce ?? b.time_in_force ?? 'day',
      positionIntent: b.positionIntent ?? b.position_intent,
      requestedByUserId: b.requestedByUserId ?? null,
      marketDataSource: b.marketDataSource ?? null,
    });
    logAutomationEvent({
      service: 'manual-trading',
      event: 'MANUAL_INTENT_CREATED',
      symbol: intent.optionSymbol,
      payload: { intentId: String(intent._id), side: intent.side, quantity: intent.quantity, orderType: intent.orderType, payloadHash: intent.payloadHash },
    });
    res.status(201).json({ intent: sanitize(intent) });
  } catch (error) {
    next(error);
  }
});

// POST /api/trading/manual/intents/:id/confirm — explicit user confirmation.
router.post('/intents/:id/confirm', async (req, res, next) => {
  try {
    const intent = await confirmManualIntent(req.params.id);
    if (!intent) return res.status(404).json({ error: 'intent not found' });
    logAutomationEvent({
      service: 'manual-trading',
      event: 'MANUAL_ORDER_CONFIRMED',
      symbol: intent.optionSymbol,
      payload: { intentId: String(intent._id), status: intent.status },
    });
    res.json({ intent: sanitize(intent) });
  } catch (error) {
    next(error);
  }
});

// POST /api/trading/manual/intents/:id/submit — governed submission. Idempotent.
router.post('/intents/:id/submit', async (req, res, next) => {
  try {
    const gates = await gatherGates();
    // The client re-sends the order it is confirming; a changed payload is rejected.
    const submittedPayloadHash = req.body?.order != null ? orderPayloadHash(req.body.order) : null;
    logAutomationEvent({
      service: 'manual-trading',
      event: 'ORDER_SUBMISSION_REQUESTED',
      payload: { intentId: req.params.id, executionMode: 'MANUAL', orderSource: 'MANUAL_UI' },
    });
    const result = await submitManualIntent(req.params.id, {
      gates,
      submittedPayloadHash,
      brokerSubmit: order => submitAlpacaOptionsOrder(order as any),
    });

    if (result.outcome === 'REJECTED') {
      logAutomationEvent({
        service: 'execution-gateway',
        event: 'ORDER_SUBMISSION_BLOCKED',
        severity: 'warning',
        symbol: result.intent.optionSymbol,
        payload: { intentId: req.params.id, reason: result.rejectionReason, executionMode: 'MANUAL', orderSource: 'MANUAL_UI' },
      });
      return res.status(409).json({ outcome: result.outcome, reason: result.rejectionReason, intent: sanitize(result.intent) });
    }
    if (result.outcome === 'FAILED') {
      return res.status(502).json({ outcome: result.outcome, reason: result.rejectionReason, intent: sanitize(result.intent) });
    }
    logAutomationEvent({
      service: 'manual-trading',
      event: result.outcome === 'ALREADY_SUBMITTED' ? 'DUPLICATE_SUBMISSION_PREVENTED' : 'BROKER_ORDER_SUBMITTED',
      symbol: result.intent.optionSymbol,
      payload: {
        intentId: req.params.id,
        executionMode: 'MANUAL',
        orderSource: 'MANUAL_UI',
        clientOrderId: result.intent.clientOrderId,
        brokerOrderId: result.intent.brokerOrderId,
        outcome: result.outcome,
      },
    });
    res.json({ outcome: result.outcome, intent: sanitize(result.intent), brokerOrder: result.brokerOrder });
  } catch (error) {
    next(error);
  }
});

/** Strip internal Mongoose fields for the API response. */
function sanitize(doc: any) {
  return {
    id: String(doc._id),
    status: doc.status,
    executionMode: doc.executionMode,
    orderSource: doc.orderSource,
    optionSymbol: doc.optionSymbol,
    side: doc.side,
    quantity: doc.quantity,
    orderType: doc.orderType,
    limitPrice: doc.limitPrice,
    timeInForce: doc.timeInForce,
    payloadHash: doc.payloadHash,
    clientOrderId: doc.clientOrderId,
    brokerOrderId: doc.brokerOrderId,
    rejectionReason: doc.rejectionReason,
    confirmedAt: doc.confirmedAt,
    submittedAt: doc.submittedAt,
  };
}

export const manualTradingRouter = router;
