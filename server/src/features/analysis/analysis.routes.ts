
import { Router } from 'express';
// Analysis router: bridges client watchlist/checklist requests to option analytics services.
import { getWatchlistReports } from '../options/services/watchlistReports';
import { evaluateChecklistBatch, getStoredChecklist } from '../options/services/optionsChecklist';
import { getDeskInsight } from './deskInsight';

const router = Router();

function normalizeTickers(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(value => value.toUpperCase());
}

router.post('/watchlist', async (req, res, next) => {
  try {
    const tickers = normalizeTickers(req.body?.tickers);
    if (!tickers.length) {
      return res.status(400).json({ error: 'tickers array is required' });
    }
    const limited = Array.from(new Set(tickers)).slice(0, 12);
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

router.post('/insight', async (req, res, next) => {
  try {
    const raw = req.body?.symbol ?? req.body?.ticker;
    const symbol = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
    if (!symbol) {
      return res.status(400).json({ error: 'symbol is required' });
    }
    const insight = await getDeskInsight(symbol);
    res.json(insight);
  } catch (error) {
    next(error);
  }
});

router.post('/checklist', async (req, res, next) => {
  try {
    const payload = req.body ?? {};
    const tickers = normalizeTickers(payload?.tickers ?? (payload?.ticker ? [payload.ticker] : []));
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
