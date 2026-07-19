import { Router, type Request, type Response } from 'express';
import {
  listWatchlistWithLiveStatus,
  removeWatchlistItem,
  updateWatchlistItem,
  upsertWatchlistItem,
  WatchlistValidationError,
} from './watchlist.service';
import { getAutomationUniverse, refreshAutomationUniverse } from './automationUniverseProvider.service';

// Sprint 2E — the Watchlist Control Center API. All automation-universe writes
// go through here; each write invalidates the provider cache (in the service),
// so operator changes are effective WITHOUT a server restart. This router never
// touches the broker — it only curates the universe the scheduler evaluates.

export const watchlistRouter = Router();

function handleError(res: Response, error: unknown): void {
  if (error instanceof WatchlistValidationError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  res.status(500).json({ error: (error as any)?.message ?? 'Internal error' });
}

// Full watchlist (UI control center) — with broker-truth live status.
watchlistRouter.get('/', async (_req: Request, res: Response) => {
  try {
    res.json({ items: await listWatchlistWithLiveStatus() });
  } catch (error) {
    handleError(res, error);
  }
});

// The resolved automation universe (what the scheduler would evaluate now).
watchlistRouter.get('/universe', async (_req: Request, res: Response) => {
  try {
    res.json(await getAutomationUniverse());
  } catch (error) {
    handleError(res, error);
  }
});

// Force a cache refresh (diagnostics).
watchlistRouter.post('/refresh', async (_req: Request, res: Response) => {
  try {
    res.json(await refreshAutomationUniverse());
  } catch (error) {
    handleError(res, error);
  }
});

// Add or update a symbol.
watchlistRouter.post('/', async (req: Request, res: Response) => {
  try {
    if (!req.body?.symbol) {
      res.status(400).json({ error: 'symbol is required' });
      return;
    }
    res.status(201).json(await upsertWatchlistItem(req.body));
  } catch (error) {
    handleError(res, error);
  }
});

// Patch a symbol's automation fields (enable/disable, priority, DTE, spread…).
watchlistRouter.patch('/:symbol', async (req: Request, res: Response) => {
  try {
    const doc = await updateWatchlistItem(req.params.symbol, req.body ?? {});
    if (!doc) {
      res.status(404).json({ error: `Symbol ${req.params.symbol} not on watchlist` });
      return;
    }
    res.json(doc);
  } catch (error) {
    handleError(res, error);
  }
});

// Convenience toggle: enable/disable automation for a symbol.
watchlistRouter.post('/:symbol/automation', async (req: Request, res: Response) => {
  try {
    const enabled = Boolean(req.body?.enabled ?? req.body?.automationEnabled);
    const doc = await updateWatchlistItem(req.params.symbol, { automationEnabled: enabled });
    if (!doc) {
      res.status(404).json({ error: `Symbol ${req.params.symbol} not on watchlist` });
      return;
    }
    res.json(doc);
  } catch (error) {
    handleError(res, error);
  }
});

watchlistRouter.delete('/:symbol', async (req: Request, res: Response) => {
  try {
    const removed = await removeWatchlistItem(req.params.symbol);
    res.status(removed ? 200 : 404).json({ removed });
  } catch (error) {
    handleError(res, error);
  }
});
