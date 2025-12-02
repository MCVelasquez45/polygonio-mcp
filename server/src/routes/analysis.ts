import { Router } from 'express';
import { getWatchlistReports } from '../services/watchlistReports';

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

export default router;
