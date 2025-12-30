import { Router } from 'express';
// Broker router: thin façade over Alpaca APIs for account/positions/orders with caching.
import {
  getAlpacaAccount,
  getAlpacaClock,
  listAlpacaOptionOrders,
  listAlpacaOptionPositions,
  submitAlpacaOptionsOrder
} from './services/alpaca';

const router = Router();

// Simple in-memory caches to avoid calling Alpaca more than ~once every 10s.
const CACHE_TTL_MS = 10_000;
const ALLOWED_POSITION_INTENTS = new Set(['buy_to_open', 'buy_to_close', 'sell_to_open', 'sell_to_close']);

let cachedAccount: { data: any; expiresAt: number } | null = null;
let cachedPositions: { data: any; expiresAt: number } | null = null;

// GET /api/broker/alpaca/account – fetches account snapshot (buying power, etc.).
router.get('/alpaca/account', async (_req, res, next) => {
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
});

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

// POST /api/broker/alpaca/options/orders – normalizes legs and forwards to Alpaca.
router.post('/alpaca/options/orders', async (req, res, next) => {
  try {
    const body = req.body ?? {};
    console.log('[BROKER] order submission received', body);
    const legs = Array.isArray(body.legs) ? body.legs : [];
    if (!legs.length) {
      return res.status(400).json({ error: 'At least one leg is required' });
    }
    // Normalize each leg, applying defaults and validation before hitting Alpaca.
    const normalizedLegs = legs.map((leg: any) => {
      const symbol = typeof leg.symbol === 'string' ? leg.symbol.trim().toUpperCase() : '';
      const qty = Number(leg.qty ?? leg.quantity ?? 0);
      const side = leg.side === 'sell' ? 'sell' : 'buy';
      const limitPrice = leg.limitPrice ?? leg.limit_price;
      const type = leg.type ?? (limitPrice != null ? 'limit' : 'market');
      const intentRaw = leg.position_intent ?? leg.positionIntent;
      const positionIntent =
        typeof intentRaw === 'string' && ALLOWED_POSITION_INTENTS.has(intentRaw) ? intentRaw : undefined;
      if (!symbol || !Number.isFinite(qty) || qty <= 0) {
        throw new Error('Invalid leg payload');
      }
      return {
        symbol,
        qty,
        side,
        type,
        ...(limitPrice != null ? { limit_price: Number(limitPrice) } : {}),
        ...(positionIntent ? { position_intent: positionIntent } : {})
      };
    });
    const limitPriceRaw = body.limitPrice ?? body.limit_price;
    const limitPriceValue = Number(limitPriceRaw);
    const orderClass =
      typeof body.orderClass === 'string'
        ? body.orderClass
        : typeof body.order_class === 'string'
        ? body.order_class
        : undefined;
    const orderType =
      typeof body.orderType === 'string'
        ? body.orderType
        : typeof body.order_type === 'string'
        ? body.order_type
        : undefined;
    const payload = {
      legs: normalizedLegs,
      quantity: Number(body.quantity ?? 1),
      order_class: orderClass,
      order_type: orderType,
      limit_price: Number.isFinite(limitPriceValue) ? Math.abs(limitPriceValue) : undefined,
      time_in_force: body.timeInForce ?? body.time_in_force ?? 'day',
      client_order_id: body.clientOrderId ?? body.client_order_id,
      extended_hours: Boolean(body.extendedHours ?? body.extended_hours)
    };
    console.log('[BROKER] normalized Alpaca payload', payload);
    const order = await submitAlpacaOptionsOrder(payload);
    console.log('[BROKER] Alpaca order response', order);
    res.json(order);
  } catch (error) {
    next(error);
  }
});

export default router;
