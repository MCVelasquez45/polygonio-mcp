import { Router } from 'express';
import { getWatchlistReports } from '../services/watchlistReports';
import { evaluateChecklistBatch, getStoredChecklist } from '../services/optionsChecklist';

const router = Router();

router.post('/watchlist', async (req, res, next) => {
  try {
    const tickers = Array.isArray(req.body?.tickers)
      ? req.body.tickers.filter((value: any) => typeof value === 'string' && value.trim().length)
      : [];
    if (!tickers.length) {
      return res.status(400).json({ error: 'tickers array is required' });
    }
    const limited = Array.from(new Set(tickers.map((ticker: string) => ticker.toUpperCase()))).slice(0, 12);
    const { reports, source } = await getWatchlistReports(limited);
    res.json({
      reports,
      source,
      fetchedAt: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

router.post('/checklist', async (req, res, next) => {
  try {
    const payload = req.body ?? {};
    const tickersPayload = Array.isArray(payload?.tickers)
      ? payload.tickers
      : typeof payload?.ticker === 'string'
      ? [payload.ticker]
      : [];
    const tickers = tickersPayload
      .filter((value: any) => typeof value === 'string' && value.trim().length)
      .map((value: string) => value.toUpperCase());
    if (!tickers.length) {
      return res.status(400).json({ error: 'tickers array is required' });
    }
    const limited = Array.from(new Set(tickers)).slice(0, 12);
    const force = Boolean(payload?.force);
    const results = await evaluateChecklistBatch(limited, { force });
    res.json({
      results,
      fetchedAt: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

router.get('/checklist/:symbol', async (req, res, next) => {
  try {
    const symbol = req.params.symbol?.toUpperCase();
    if (!symbol) {
      return res.status(400).json({ error: 'symbol parameter is required' });
    }
    const result = await getStoredChecklist(symbol);
    if (!result) {
      return res.status(404).json({ error: 'Checklist result not found' });
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
