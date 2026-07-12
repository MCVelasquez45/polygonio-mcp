import { Router } from 'express';
// Broker router: thin façade over Alpaca APIs for account/positions/orders with caching.
import {
  getAlpacaAccount,
  getAlpacaClock,
  listAlpacaOptionOrders,
  listAlpacaOptionPositions,
  listAlpacaPositions,
  submitAlpacaOptionsOrder
} from './services/alpaca';
import {
  startAlpacaPaperSession,
  getAlpacaPaperSession,
  listAlpacaPaperSessions,
  controlAlpacaPaperSession,
} from './services/alpacaPaperRuntime.service';
import {
  startOptionsPaperSession,
  getOptionsPaperSession,
  listOptionsPaperSessions,
  controlOptionsPaperSession,
} from './services/optionsPaperRuntime.service';
import { requireTrader } from '../../shared/auth';

const router = Router();

// Simple in-memory caches to avoid calling Alpaca more than ~once every 10s.
const CACHE_TTL_MS = 10_000;
const ALLOWED_POSITION_INTENTS = new Set(['buy_to_open', 'buy_to_close', 'sell_to_open', 'sell_to_close']);

let cachedAccount: { data: any; expiresAt: number } | null = null;
let cachedPositions: { data: any; expiresAt: number } | null = null;

router.use(requireTrader);

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
    const stopPriceRaw = body.stopPrice ?? body.stop_price;
    const stopPriceValue = Number(stopPriceRaw);
    const trailPriceRaw = body.trailPrice ?? body.trail_price;
    const trailPriceValue = Number(trailPriceRaw);
    const trailPercentRaw = body.trailPercent ?? body.trail_percent;
    const trailPercentValue = Number(trailPercentRaw);
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
      stop_price: Number.isFinite(stopPriceValue) ? Math.abs(stopPriceValue) : undefined,
      trail_price: Number.isFinite(trailPriceValue) ? Math.abs(trailPriceValue) : undefined,
      trail_percent: Number.isFinite(trailPercentValue) ? Math.abs(trailPercentValue) : undefined,
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

// ---------------------------------------------------------------------------
// Alpaca paper trading (real orders on paper account)
// ---------------------------------------------------------------------------

// POST /api/broker/alpaca/paper/start – start an Alpaca paper trading session
router.post('/alpaca/paper/start', async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const strategyId = String(body.strategyId ?? '').trim();
    const strategyName = String(body.strategyName ?? '').trim();
    const symbol = String(body.symbol ?? '').trim().toUpperCase();
    const qty = Number(body.qty ?? body.quantity ?? 1);
    const initialCapital = body.initialCapital != null ? Number(body.initialCapital) : undefined;
    const maxDailyLoss = body.maxDailyLoss != null ? Number(body.maxDailyLoss) : undefined;
    const maxDrawdownPct = body.maxDrawdownPct != null ? Number(body.maxDrawdownPct) : undefined;
    const intervalSeconds = body.intervalSeconds != null ? Number(body.intervalSeconds) : undefined;

    if (!strategyId || !strategyName || !symbol) {
      return res.status(400).json({ error: 'strategyId, strategyName, and symbol are required' });
    }

    const backtestId = body.backtestId ? String(body.backtestId).trim() : undefined;
    const versionLabel = body.versionLabel ? String(body.versionLabel).trim() : undefined;

    const session = await startAlpacaPaperSession({
      strategyId,
      strategyName,
      backtestId,
      versionLabel,
      symbol,
      qty,
      initialCapital,
      maxDailyLoss,
      maxDrawdownPct,
      intervalSeconds,
    });

    res.json(session);
  } catch (error) {
    next(error);
  }
});

// GET /api/broker/alpaca/paper/sessions – list Alpaca paper sessions
router.get('/alpaca/paper/sessions', async (req, res, next) => {
  try {
    const strategyId = typeof req.query.strategyId === 'string' ? req.query.strategyId : undefined;
    const sessions = await listAlpacaPaperSessions(strategyId);
    res.json({ sessions });
  } catch (error) {
    next(error);
  }
});

// GET /api/broker/alpaca/paper/:sessionId – get a single Alpaca paper session
router.get('/alpaca/paper/:sessionId', async (req, res, next) => {
  try {
    const session = await getAlpacaPaperSession(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Alpaca paper session not found' });
    res.json(session);
  } catch (error) {
    next(error);
  }
});

// POST /api/broker/alpaca/paper/:sessionId/control – pause/resume/stop an Alpaca paper session
router.post('/alpaca/paper/:sessionId/control', async (req, res, next) => {
  try {
    const action = req.body?.action as 'pause' | 'resume' | 'stop';
    if (!['pause', 'resume', 'stop'].includes(action)) {
      return res.status(400).json({ error: "action must be one of: 'pause', 'resume', 'stop'" });
    }
    const session = await controlAlpacaPaperSession(req.params.sessionId, action);
    res.json(session);
  } catch (error) {
    next(error);
  }
});

// GET /api/broker/alpaca/positions – all positions (equities + options)
router.get('/alpaca/positions', async (_req, res, next) => {
  try {
    const positions = await listAlpacaPositions();
    res.json({ positions });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Alpaca options paper trading
// ---------------------------------------------------------------------------

// POST /api/broker/alpaca/options-paper/start – start an options paper trading session
router.post('/alpaca/options-paper/start', async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const strategyId = String(body.strategyId ?? '').trim();
    const strategyName = String(body.strategyName ?? '').trim();
    const qty = Number(body.qty ?? body.quantity ?? 1);
    const intervalSeconds = body.intervalSeconds != null ? Number(body.intervalSeconds) : 30;

    if (!strategyId || !strategyName) {
      return res.status(400).json({ error: 'strategyId and strategyName are required' });
    }

    const backtestId = body.backtestId ? String(body.backtestId).trim() : undefined;
    const versionLabel = body.versionLabel ? String(body.versionLabel).trim() : undefined;

    const session = await startOptionsPaperSession({
      strategyId,
      strategyName,
      backtestId,
      versionLabel,
      qty,
      intervalSeconds,
    });

    res.json(session);
  } catch (error) {
    next(error);
  }
});

// GET /api/broker/alpaca/options-paper/sessions – list options paper sessions
router.get('/alpaca/options-paper/sessions', async (req, res, next) => {
  try {
    const strategyId = typeof req.query.strategyId === 'string' ? req.query.strategyId : undefined;
    const sessions = await listOptionsPaperSessions(strategyId);
    res.json({ sessions });
  } catch (error) {
    next(error);
  }
});

// GET /api/broker/alpaca/options-paper/:sessionId – get a single options paper session
router.get('/alpaca/options-paper/:sessionId', async (req, res, next) => {
  try {
    const session = await getOptionsPaperSession(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Options paper session not found' });
    res.json(session);
  } catch (error) {
    next(error);
  }
});

// POST /api/broker/alpaca/options-paper/:sessionId/control – pause/resume/stop an options paper session
router.post('/alpaca/options-paper/:sessionId/control', async (req, res, next) => {
  try {
    const action = req.body?.action as 'pause' | 'resume' | 'stop';
    if (!['pause', 'resume', 'stop'].includes(action)) {
      return res.status(400).json({ error: "action must be one of: 'pause', 'resume', 'stop'" });
    }
    const session = await controlOptionsPaperSession(req.params.sessionId, action);
    res.json(session);
  } catch (error) {
    next(error);
  }
});

export default router;
