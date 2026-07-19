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
import {
  backfillTradeReportsForDate,
  generateTradeReportForTrade,
  getTradeReportById,
  getTradeReportsBySession,
  listTradeReports,
} from './services/tradeReportGenerator.service';
import {
  backfillDailyReportsForDate,
  generateDailyReportForSession,
  getDailyReportById,
  getDailyReportsByDate,
  getLatestDailyReport,
  listDailyReports,
} from './services/dailyReportGenerator.service';
import {
  backfillDecisionJournalForDate,
  getDecisionJournalEntriesBySession,
  getDecisionJournalEntriesByTrade,
  getDecisionJournalEntryById,
  listDecisionJournalEntries,
} from './services/decisionJournal.service';
import {
  generateStrategyAnalyticsForWindowType,
  getLatestStrategyAnalytics,
  getStrategyAnalyticsByDate,
  getStrategyAnalyticsByWindowType,
  listStrategyAnalytics,
  validateWindowType,
} from './services/strategyAnalytics.service';

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

intelligenceRouter.get('/daily', async (req, res) => {
  try {
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 50;
    const reports = await listDailyReports(Number.isFinite(limit) ? limit : 50);
    res.json({ reports });
  } catch (error) {
    sendError(res, error);
  }
});

intelligenceRouter.get('/analytics', async (req, res) => {
  try {
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 50;
    const analytics = await listStrategyAnalytics(Number.isFinite(limit) ? limit : 50);
    res.json({ analytics });
  } catch (error) {
    sendError(res, error);
  }
});

intelligenceRouter.get('/analytics/latest', async (_req, res) => {
  try {
    const analytics = await getLatestStrategyAnalytics();
    if (!analytics) {
      res.status(404).json({ error: 'STRATEGY_ANALYTICS_NOT_FOUND' });
      return;
    }
    res.json({ analytics });
  } catch (error) {
    sendError(res, error);
  }
});

intelligenceRouter.get('/analytics/window/:type', async (req, res) => {
  try {
    const windowType = validateWindowType(req.params.type);
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 50;
    const analytics = await getStrategyAnalyticsByWindowType(windowType, Number.isFinite(limit) ? limit : 50);
    res.json({ analytics });
  } catch (error) {
    sendError(res, error);
  }
});

intelligenceRouter.get('/analytics/date/:date', async (req, res) => {
  try {
    validateTradingDate(req.params.date);
    const analytics = await getStrategyAnalyticsByDate(req.params.date);
    if (!analytics.length) {
      res.status(404).json({ error: 'STRATEGY_ANALYTICS_NOT_FOUND' });
      return;
    }
    res.json({ analytics });
  } catch (error) {
    sendError(res, error);
  }
});

intelligenceRouter.post('/analytics/generate', async (req, res) => {
  try {
    if (!requireAdminToken(req, res)) return;
    const tradingDate = typeof req.body?.tradingDate === 'string' ? req.body.tradingDate : '';
    validateTradingDate(tradingDate);
    const windowType = req.body?.windowType ? validateWindowType(String(req.body.windowType)) : 'DAILY';
    const result = await generateStrategyAnalyticsForWindowType(windowType, tradingDate);
    res.status(result.idempotent ? 200 : 201).json(result);
  } catch (error) {
    sendError(res, error);
  }
});

intelligenceRouter.get('/decisions', async (req, res) => {
  try {
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 100;
    const entries = await listDecisionJournalEntries(Number.isFinite(limit) ? limit : 100);
    res.json({ entries });
  } catch (error) {
    sendError(res, error);
  }
});

intelligenceRouter.get('/decisions/session/:sessionId', async (req, res) => {
  try {
    const entries = await getDecisionJournalEntriesBySession(req.params.sessionId);
    res.json({ entries });
  } catch (error) {
    sendError(res, error);
  }
});

intelligenceRouter.get('/decisions/trade/:tradeId', async (req, res) => {
  try {
    const entries = await getDecisionJournalEntriesByTrade(req.params.tradeId);
    res.json({ entries });
  } catch (error) {
    sendError(res, error);
  }
});

intelligenceRouter.get('/decisions/:id', async (req, res) => {
  try {
    const entry = await getDecisionJournalEntryById(req.params.id);
    if (!entry) {
      res.status(404).json({ error: 'DECISION_JOURNAL_ENTRY_NOT_FOUND' });
      return;
    }
    res.json({ entry });
  } catch (error) {
    sendError(res, error);
  }
});

intelligenceRouter.post('/decisions/backfill/:tradingDate', async (req, res) => {
  try {
    if (!requireAdminToken(req, res)) return;
    validateTradingDate(req.params.tradingDate);
    const results = await backfillDecisionJournalForDate(req.params.tradingDate);
    const typeCounts = results.reduce<Record<string, number>>((counts, result) => {
      const type = result.entry.decisionType;
      counts[type] = (counts[type] ?? 0) + 1;
      return counts;
    }, {});
    res.json({
      entries: results.map(result => result.entry),
      generated: results.filter(result => !result.idempotent).length,
      existing: results.filter(result => result.idempotent).length,
      typeCounts,
    });
  } catch (error) {
    sendError(res, error);
  }
});

intelligenceRouter.get('/daily/latest', async (_req, res) => {
  try {
    const report = await getLatestDailyReport();
    if (!report) {
      res.status(404).json({ error: 'DAILY_REPORT_NOT_FOUND' });
      return;
    }
    res.json({ report });
  } catch (error) {
    sendError(res, error);
  }
});

intelligenceRouter.get('/daily/date/:tradingDate', async (req, res) => {
  try {
    validateTradingDate(req.params.tradingDate);
    const reports = await getDailyReportsByDate(req.params.tradingDate);
    if (!reports.length) {
      res.status(404).json({ error: 'DAILY_REPORT_NOT_FOUND' });
      return;
    }
    res.json({ reports });
  } catch (error) {
    sendError(res, error);
  }
});

intelligenceRouter.get('/daily/:id', async (req, res) => {
  try {
    const report = await getDailyReportById(req.params.id);
    if (!report) {
      res.status(404).json({ error: 'DAILY_REPORT_NOT_FOUND' });
      return;
    }
    res.json({ report });
  } catch (error) {
    sendError(res, error);
  }
});

intelligenceRouter.post('/daily/backfill/:tradingDate', async (req, res) => {
  try {
    if (!requireAdminToken(req, res)) return;
    validateTradingDate(req.params.tradingDate);
    const results = await backfillDailyReportsForDate(req.params.tradingDate);
    res.json({
      reports: results.map(result => result.report),
      generated: results.filter(result => !result.idempotent).length,
      existing: results.filter(result => result.idempotent).length,
    });
  } catch (error) {
    sendError(res, error);
  }
});

intelligenceRouter.post('/daily/:sessionId/generate', async (req, res) => {
  try {
    if (!requireAdminToken(req, res)) return;
    const result = await generateDailyReportForSession(req.params.sessionId);
    res.status(result.idempotent ? 200 : 201).json(result);
  } catch (error) {
    sendError(res, error);
  }
});

intelligenceRouter.get('/trades', async (req, res) => {
  try {
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 50;
    const reports = await listTradeReports(Number.isFinite(limit) ? limit : 50);
    res.json({ reports });
  } catch (error) {
    sendError(res, error);
  }
});

intelligenceRouter.get('/trades/session/:sessionId', async (req, res) => {
  try {
    const reports = await getTradeReportsBySession(req.params.sessionId);
    res.json({ reports });
  } catch (error) {
    sendError(res, error);
  }
});

intelligenceRouter.get('/trades/:id', async (req, res) => {
  try {
    const report = await getTradeReportById(req.params.id);
    if (!report) {
      res.status(404).json({ error: 'TRADE_REPORT_NOT_FOUND' });
      return;
    }
    res.json({ report });
  } catch (error) {
    sendError(res, error);
  }
});

intelligenceRouter.post('/trades/backfill/:tradingDate', async (req, res) => {
  try {
    if (!requireAdminToken(req, res)) return;
    validateTradingDate(req.params.tradingDate);
    const results = await backfillTradeReportsForDate(req.params.tradingDate);
    res.json({
      reports: results.map(result => result.report),
      generated: results.filter(result => !result.idempotent).length,
      existing: results.filter(result => result.idempotent).length,
    });
  } catch (error) {
    sendError(res, error);
  }
});

intelligenceRouter.post('/trades/:tradeId/generate', async (req, res) => {
  try {
    if (!requireAdminToken(req, res)) return;
    const result = await generateTradeReportForTrade(req.params.tradeId);
    res.status(result.idempotent ? 200 : 201).json(result);
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
