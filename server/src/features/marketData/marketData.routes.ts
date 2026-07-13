import { Router } from 'express';
import { buildMarketDataHealthReport } from './optionsDataHealth.service';
import { getOptionChainWindow, getUnderlyingContext } from './optionsMarketDataOrchestrator.service';
import { getActiveOptionSubscriptions } from './optionsSubscriptionManager.service';
import { chainCacheAgeMs } from './optionsChainCache.service';
import { REQUEST_PRIORITY } from '../../shared/data/massive';

// Market-data health surface (Options Advanced alignment):
//   GET /api/market-data/health
//   GET /api/market-data/options/:underlying/status

const router = Router();

router.get('/health', (_req, res) => {
  res.json(buildMarketDataHealthReport());
});

router.get('/options/:underlying/status', async (req, res, next) => {
  try {
    const underlying = String(req.params.underlying ?? '').trim().toUpperCase();
    if (!underlying) {
      res.status(400).json({ error: 'underlying is required' });
      return;
    }
    const report = buildMarketDataHealthReport();
    const underlyingContext = await getUnderlyingContext(underlying, REQUEST_PRIORITY.VISIBLE_UI);
    res.json({
      underlying,
      ...report,
      underlyingContext,
      activeSubscriptions: getActiveOptionSubscriptions().filter(sub =>
        sub.symbol.includes(underlying)
      ),
    });
  } catch (error) {
    next(error);
  }
});

export { router as marketDataRouter, getOptionChainWindow, chainCacheAgeMs };
