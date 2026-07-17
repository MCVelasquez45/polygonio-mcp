import { Router, type Request, type Response } from 'express';
import {
  backfillTradingSession,
  captureSessionProgress,
  finalizeTradingSession,
  getLatestTradingSession,
  getTradingSessionByDate,
  getTradingSessionBySessionId,
  listTradingSessions,
  validateTradingDate,
} from './services/tradingSessionCapture.service';

export const intelligenceRouter = Router();

function sendError(res: Response, error: unknown): void {
  const status = typeof (error as any)?.status === 'number' ? (error as any).status : 500;
  res.status(status).json({ error: (error as Error)?.message ?? 'intelligence request failed' });
}

function requireAdminToken(req: Request, res: Response): boolean {
  const configured = process.env.INTELLIGENCE_ADMIN_TOKEN;
  if (!configured) {
    res.status(403).json({
      error: 'INTELLIGENCE_ADMIN_AUTH_UNAVAILABLE',
      message: 'State-changing intelligence actions require INTELLIGENCE_ADMIN_TOKEN.',
    });
    return false;
  }
  const provided = req.header('x-operator-token') ?? '';
  if (provided !== configured) {
    res.status(403).json({ error: 'INTELLIGENCE_ADMIN_FORBIDDEN' });
    return false;
  }
  return true;
}

intelligenceRouter.get('/sessions', async (req, res) => {
  try {
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 50;
    const sessions = await listTradingSessions(Number.isFinite(limit) ? limit : 50);
    res.json({ sessions });
  } catch (error) {
    sendError(res, error);
  }
});

intelligenceRouter.get('/sessions/latest', async (_req, res) => {
  try {
    const session = await getLatestTradingSession();
    if (!session) {
      res.status(404).json({ error: 'TRADING_SESSION_NOT_FOUND' });
      return;
    }
    res.json({ session });
  } catch (error) {
    sendError(res, error);
  }
});

intelligenceRouter.get('/sessions/date/:tradingDate', async (req, res) => {
  try {
    validateTradingDate(req.params.tradingDate);
    const sessions = await getTradingSessionByDate(req.params.tradingDate);
    if (!sessions.length) {
      res.status(404).json({ error: 'TRADING_SESSION_NOT_FOUND' });
      return;
    }
    res.json({ sessions });
  } catch (error) {
    sendError(res, error);
  }
});

intelligenceRouter.get('/sessions/:sessionId', async (req, res) => {
  try {
    const session = await getTradingSessionBySessionId(req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: 'TRADING_SESSION_NOT_FOUND' });
      return;
    }
    res.json({ session });
  } catch (error) {
    sendError(res, error);
  }
});

intelligenceRouter.post('/sessions/capture', async (req, res) => {
  try {
    if (!requireAdminToken(req, res)) return;
    const tradingDate = typeof req.body?.tradingDate === 'string' ? req.body.tradingDate : undefined;
    if (tradingDate) validateTradingDate(tradingDate);
    const automationSessionId =
      typeof req.body?.automationSessionId === 'string' ? req.body.automationSessionId : undefined;
    const session = await captureSessionProgress({ tradingDate, automationSessionId });
    res.json({ session });
  } catch (error) {
    sendError(res, error);
  }
});

intelligenceRouter.post('/sessions/backfill/:tradingDate', async (req, res) => {
  try {
    if (!requireAdminToken(req, res)) return;
    validateTradingDate(req.params.tradingDate);
    const result = await backfillTradingSession(req.params.tradingDate);
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
});

intelligenceRouter.post('/sessions/:sessionId/finalize', async (req, res) => {
  try {
    if (!requireAdminToken(req, res)) return;
    const result = await finalizeTradingSession(req.params.sessionId);
    res.status(result.finalized ? 200 : 409).json(result);
  } catch (error) {
    sendError(res, error);
  }
});
