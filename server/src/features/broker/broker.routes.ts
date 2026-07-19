import { Router } from 'express';
// Broker router: thin façade over Alpaca APIs for account/positions/orders with caching.
// Order SUBMISSION is intentionally NOT here — it is governed by the manual
// execution gateway (manualTrading.routes) and the automation engine.
import {
  cancelAlpacaOrder,
  getAlpacaAccount,
  getAlpacaClock,
  listAlpacaOptionOrders,
  listAlpacaOptionPositions
} from './services/alpaca';
import { logAutomationEvent } from '../automation/services/automationAudit.service';

const router = Router();

// Simple in-memory caches to avoid calling Alpaca more than ~once every 10s.
const CACHE_TTL_MS = 10_000;

let cachedAccount: { data: any; expiresAt: number } | null = null;
let cachedPositions: { data: any; expiresAt: number } | null = null;

// GET /api/broker/alpaca/account – fetches account snapshot (buying power, etc.).
async function getAccountSnapshot(_req: any, res: any, next: any) {
  try {
    const now = Date.now();
    if (cachedAccount && cachedAccount.expiresAt > now) {
      return res.json(cachedAccount.data);
    }
    const account = await getAlpacaAccount();
    cachedAccount = { data: account, expiresAt: now + CACHE_TTL_MS };
    res.json(account);
  } catch (error) {
    next(error);
  }
}

router.get('/alpaca/account', getAccountSnapshot);
router.get('/account', getAccountSnapshot);

// GET /api/broker/alpaca/clock – returns Alpaca market clock.
router.get('/alpaca/clock', async (_req, res, next) => {
  try {
    const clock = await getAlpacaClock();
    res.json(clock);
  } catch (error) {
    next(error);
  }
});

// GET /api/broker/alpaca/options/positions – returns option positions with a short cache.
router.get('/alpaca/options/positions', async (_req, res, next) => {
  try {
    const now = Date.now();
    if (cachedPositions && cachedPositions.expiresAt > now) {
      return res.json({ positions: cachedPositions.data });
    }
    const positions = await listAlpacaOptionPositions();
    cachedPositions = { data: positions, expiresAt: now + CACHE_TTL_MS };
    res.json({ positions });
  } catch (error) {
    next(error);
  }
});

router.get('/alpaca/options/orders', async (req, res, next) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
    const orders = await listAlpacaOptionOrders({ status, limit });
    res.json({ orders });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/broker/alpaca/options/orders/:orderId – cancel an open order.
// Cancellation is a risk-REDUCING lifecycle action on an order that already
// passed a governed submission path; it does not create broker exposure, so it
// lives on the façade rather than behind the intent gateway.
router.delete('/alpaca/options/orders/:orderId', async (req, res, next) => {
  try {
    const orderId = req.params.orderId;
    await cancelAlpacaOrder(orderId);
    logAutomationEvent({
      service: 'manual-trading',
      event: 'MANUAL_ORDER_CANCEL_REQUESTED',
      payload: { brokerOrderId: orderId, route: 'DELETE /api/broker/alpaca/options/orders/:orderId' },
    });
    res.status(202).json({ canceled: true, orderId });
  } catch (error: any) {
    const status = error?.response?.status ?? error?.statusCode;
    if (status === 404) return res.status(404).json({ error: 'order not found' });
    if (status === 422) return res.status(422).json({ error: 'order is not cancelable' });
    next(error);
  }
});

// POST /api/broker/alpaca/options/orders – DEPRECATED direct submission path.
//
// This ungoverned route used to forward any payload straight to Alpaca (the
// accidental-submission defect). It is now FAIL-CLOSED: manual paper orders must
// go through the governed lifecycle at POST /api/trading/manual/intents →
// /confirm → /submit (execution gateway), and automation uses its own engine
// path. Direct submission here is refused so no order-shaped payload from a
// research/selection surface can ever reach the broker.
router.post('/alpaca/options/orders', async (req, res, next) => {
  try {
    logAutomationEvent({
      service: 'execution-gateway',
      event: 'ORDER_SUBMISSION_BLOCKED',
      severity: 'warning',
      payload: {
        route: 'POST /api/broker/alpaca/options/orders',
        reason: 'DIRECT_BROKER_SUBMISSION_DISABLED',
        detail: 'use the governed manual path /api/trading/manual/intents/:id/{confirm,submit}',
      },
    });
    return res.status(410).json({
      error: 'DIRECT_BROKER_SUBMISSION_DISABLED',
      message:
        'Direct broker order submission is disabled. Manual paper orders must use ' +
        'POST /api/trading/manual/intents then /confirm then /submit (execution gateway). ' +
        'Automation submits through its own deterministic engine path.',
    });
  } catch (error) {
    next(error);
  }
});

export default router;
