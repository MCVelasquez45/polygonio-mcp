import { Router, type Response } from 'express';
import {
  getLatestEventRecord,
  listEventRecords,
  listEventRecordsBySector,
  listEventRecordsBySymbol,
} from '../storage/eventJournal.service';
import { buildEventMarketContext } from '../events/eventProcessor.service';

export const eventIntelligenceRouter = Router();

function sendError(res: Response, error: unknown): void {
  const status = typeof (error as any)?.status === 'number' ? (error as any).status : 500;
  res.status(status).json({ error: (error as Error)?.message ?? 'event intelligence request failed' });
}

function limitFrom(value: unknown, fallback = 50): number {
  const parsed = typeof value === 'string' ? Number(value) : fallback;
  return Number.isFinite(parsed) ? parsed : fallback;
}

eventIntelligenceRouter.get('/events', async (req, res) => {
  try {
    res.json({ events: await listEventRecords(limitFrom(req.query.limit)) });
  } catch (error) {
    sendError(res, error);
  }
});

eventIntelligenceRouter.get('/latest', async (_req, res) => {
  try {
    const event = await getLatestEventRecord();
    if (!event) {
      res.status(404).json({ error: 'EVENT_INTELLIGENCE_NOT_FOUND' });
      return;
    }
    res.json({ event });
  } catch (error) {
    sendError(res, error);
  }
});

eventIntelligenceRouter.get('/history', async (req, res) => {
  try {
    res.json({ history: await listEventRecords(limitFrom(req.query.limit, 100)) });
  } catch (error) {
    sendError(res, error);
  }
});

eventIntelligenceRouter.get('/symbol/:ticker', async (req, res) => {
  try {
    res.json({ events: await listEventRecordsBySymbol(req.params.ticker, limitFrom(req.query.limit)) });
  } catch (error) {
    sendError(res, error);
  }
});

eventIntelligenceRouter.get('/sector/:sector', async (req, res) => {
  try {
    res.json({ events: await listEventRecordsBySector(req.params.sector, limitFrom(req.query.limit)) });
  } catch (error) {
    sendError(res, error);
  }
});

eventIntelligenceRouter.get('/context', async (req, res) => {
  try {
    res.json({ context: await buildEventMarketContext(limitFrom(req.query.limit, 100)) });
  } catch (error) {
    sendError(res, error);
  }
});
