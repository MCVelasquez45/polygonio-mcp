import { Router } from 'express';
import {
  getMassiveQuotes,
  getMassiveIndicators,
  getMassiveTrades,
  getOptionAggregates,
  getMassiveOptionContract,
  listMassiveOptionContracts,
  getMassiveOptionsChain,
  getMassiveOptionsSnapshot,
  getMassiveOptionContractSnapshot,
  listOptionExpirations,
} from '../services/massive';
import { fetchWithCache } from '../services/marketCache';
import { getLatestSelection, saveSelection } from '../services/selectionStore';

const router = Router();

function logMarketRequest(req: any) {
  try {
    const ctx = {
      params: req?.params ?? {},
      query: req?.query ?? {},
      path: req?.originalUrl ?? req?.url
    };
    console.log('[MARKET] request', req?.method ?? 'GET', ctx);
  } catch (error) {
    console.warn('[MARKET] failed to log request', error);
  }
}

function requireOptionTicker(ticker: string, res: any) {
  if (!ticker || !ticker.startsWith('O:')) {
    res.status(400).json({ error: 'Massive endpoints require option tickers prefixed with O:' });
    return false;
  }
  return true;
}

router.get('/aggs', async (req, res, next) => {
  try {
    logMarketRequest(req);
    const ticker = String(req.query.ticker ?? '').trim().toUpperCase();
    if (!ticker) {
      return res.status(400).json({ error: 'ticker is required' });
    }
    const multiplier = Number(req.query.multiplier ?? 1) || 1;
    const timespan = String(req.query.timespan ?? 'day');
    const window = Number(req.query.window ?? 120) || 120;
    const params = {
      ticker,
      multiplier,
      timespan,
      window,
      from: req.query.from ?? null,
      to: req.query.to ?? null
    };
    const { data, fetchedAt, fromCache } = await fetchWithCache(
      'aggregates',
      params,
      60_000,
      () =>
        getOptionAggregates(
          ticker,
          multiplier,
          timespan,
          window,
          req.query.from as string | undefined,
          req.query.to as string | undefined
        ),
      { ticker }
    );
    res.json({ ...data, fetchedAt, cache: fromCache ? 'hit' : 'miss' });
  } catch (error) {
    next(error);
  }
});

router.get('/trades/:ticker', async (req, res, next) => {
  try {
    logMarketRequest(req);
    const ticker = req.params.ticker.toUpperCase();
    if (!requireOptionTicker(ticker, res)) return;
    const limit = Number(req.query.limit ?? 100) || 100;
    const order = req.query.order === 'asc' ? 'asc' : 'desc';
    const { data, fetchedAt, fromCache } = await fetchWithCache(
      'trades',
      { ticker, limit, order },
      5_000,
      () => getMassiveTrades(ticker, limit, order),
      { ticker }
    );
    res.json({ ...data, fetchedAt, cache: fromCache ? 'hit' : 'miss' });
  } catch (error) {
    next(error);
  }
});

router.get('/quotes/:ticker', async (req, res, next) => {
  try {
    logMarketRequest(req);
    const ticker = req.params.ticker.toUpperCase();
    if (!requireOptionTicker(ticker, res)) return;
    const limit = Number(req.query.limit ?? 1) || 1;
    const order = req.query.order === 'asc' ? 'asc' : 'desc';
    const { data, fetchedAt, fromCache } = await fetchWithCache(
      'quotes',
      { ticker, limit, order },
      3_000,
      async () => {
        const quote = await getMassiveQuotes(ticker, { limit, order });
        if (!quote) {
          throw Object.assign(new Error('Quote not found'), { status: 404 });
        }
        return quote;
      },
      { ticker }
    );
    res.json({ ...data, fetchedAt, cache: fromCache ? 'hit' : 'miss' });
  } catch (error) {
    next(error);
  }
});

router.get('/options/chain/:ticker', async (req, res, next) => {
  try {
    logMarketRequest(req);
    const ticker = req.params.ticker.toUpperCase();
    const limit = Number(req.query.limit) || 50;
    const expirationFilter = typeof req.query.expiration === 'string' && req.query.expiration.trim().length
      ? String(req.query.expiration)
      : undefined;
    const { data, fetchedAt, fromCache } = await fetchWithCache(
      'options-chain',
      { ticker, limit, expiration: expirationFilter },
      120_000,
      async () => {
        if (ticker.startsWith('O:')) {
          const detail = await getMassiveOptionContract(ticker);
          if (!detail?.underlying) {
            const err: any = new Error('Contract not found or missing underlying');
            err.status = 404;
            throw err;
          }
          return getMassiveOptionsChain(detail.underlying, limit);
        }
        const effectiveLimit = expirationFilter ? Math.max(limit, 5000) : limit;
        const chain = await getMassiveOptionsChain(ticker, effectiveLimit);
        if (expirationFilter) {
          const filtered = Array.isArray(chain?.expirations)
            ? chain.expirations.filter(group => group?.expiration === expirationFilter)
            : [];
          if (!filtered.length) {
            const err: any = new Error('No contracts for selected expiration');
            err.status = 404;
            throw err;
          }
          return {
            ...chain,
            expirations: filtered
          };
        }
        console.log('[MARKET] options chain payload', {
          ticker,
          limit,
          expirations: Array.isArray(chain?.expirations) ? chain.expirations.length : 0,
          sample: chain?.expirations?.[0]
        });
        return chain;
      },
      { ticker }
    );
    res.json({ ...data, fetchedAt, cache: fromCache ? 'hit' : 'miss' });
  } catch (error) {
    next(error);
  }
});

router.get('/options/contracts', async (req, res, next) => {
  try {
    logMarketRequest(req);
    const limitRaw = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
    const limit = Number(limitRaw ?? 50) || 50;
    const order = typeof req.query.order === 'string' && req.query.order === 'desc' ? 'desc' : 'asc';
    const sort =
      typeof req.query.sort === 'string' && req.query.sort.trim().length ? String(req.query.sort) : undefined;
    const ticker =
      typeof req.query.ticker === 'string' && req.query.ticker.trim().length ? String(req.query.ticker) : undefined;
    const underlying =
      typeof req.query.underlying === 'string' && req.query.underlying.trim().length
        ? String(req.query.underlying)
        : undefined;
    const includeExpired =
      typeof req.query.includeExpired === 'string' && ['true', '1'].includes(req.query.includeExpired);
    const typeParam = typeof req.query.type === 'string' ? req.query.type.toLowerCase() : undefined;
    const contractType = typeParam === 'call' || typeParam === 'put' ? (typeParam as 'call' | 'put') : undefined;
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const params = { limit, order, sort, ticker, underlying, includeExpired, contractType, cursor };
    const { data, fetchedAt, fromCache } = await fetchWithCache(
      'options-contracts',
      params,
      300_000,
      () =>
        listMassiveOptionContracts({
          limit,
          order,
          sort,
          ticker,
          underlying,
          includeExpired,
          contractType,
          cursor
        }),
      { ticker: ticker ?? underlying }
    );
    res.json({ ...data, fetchedAt, cache: fromCache ? 'hit' : 'miss' });
  } catch (error) {
    next(error);
  }
});

router.get('/options/contracts/:symbol', async (req, res, next) => {
  try {
    logMarketRequest(req);
    const symbol = req.params.symbol.toUpperCase();
    if (!requireOptionTicker(symbol, res)) return;
    const { data, fetchedAt, fromCache } = await fetchWithCache(
      'options-contract-detail',
      { symbol },
      300_000,
      async () => {
        const detail = await getMassiveOptionContract(symbol);
        if (!detail) {
          const err: any = new Error('Contract not found');
          err.status = 404;
          throw err;
        }
        return detail;
      },
      { ticker: symbol }
    );
    res.json({ ...data, fetchedAt, cache: fromCache ? 'hit' : 'miss' });
  } catch (error) {
    next(error);
  }
});

router.get('/options/selection', async (req, res, next) => {
  try {
    const userId = typeof req.query.userId === 'string' && req.query.userId.trim().length ? req.query.userId : 'default';
    const selection = await getLatestSelection(userId);
    res.json({ selection });
  } catch (error) {
    next(error);
  }
});

router.post('/options/selection', async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const userId = typeof body.userId === 'string' && body.userId.trim().length ? body.userId : 'default';
    const ticker = typeof body.ticker === 'string' ? body.ticker.trim().toUpperCase() : '';
    const contract = typeof body.contract === 'string' ? body.contract.trim().toUpperCase() : '';
    const expiration = typeof body.expiration === 'string' ? body.expiration : undefined;
    const strike = typeof body.strike === 'number' ? body.strike : undefined;
    const type = body.type === 'call' || body.type === 'put' ? body.type : undefined;
    const side = body.side === 'sell' ? 'sell' : 'buy';
    if (!ticker || !contract) {
      return res.status(400).json({ error: 'ticker and contract are required' });
    }
    const document = await saveSelection(userId, { ticker, contract, expiration, strike, type, side });
    res.json({ selection: document });
  } catch (error) {
    next(error);
  }
});

router.get('/options/expirations/:ticker', async (req, res, next) => {
  try {
    logMarketRequest(req);
    const requestedTicker = req.params.ticker?.toUpperCase();
    if (!requestedTicker) {
      return res.status(400).json({ error: 'ticker is required' });
    }
    const limit = Number(req.query.limit ?? 1000) || 1000;
    const maxPages = Number(req.query.maxPages ?? 5) || 5;

    let underlyingTicker = requestedTicker;
    if (requestedTicker.startsWith('O:')) {
      const detail = await getMassiveOptionContract(requestedTicker);
      if (!detail?.underlying) {
        return res.status(404).json({ error: 'Unable to resolve underlying for contract' });
      }
      underlyingTicker = detail.underlying.toUpperCase();
    }

    const { data, fetchedAt, fromCache } = await fetchWithCache(
      'options-expirations',
      { ticker: underlyingTicker, limit, maxPages },
      300_000,
      () => listOptionExpirations(underlyingTicker, { limit, maxPages }),
      { ticker: underlyingTicker }
    );

    res.json({
      ticker: data.ticker,
      requestedTicker,
      expirations: data.expirations ?? [],
      fetchedAt,
      cache: fromCache ? 'hit' : 'miss'
    });
  } catch (error) {
    next(error);
  }
});

router.get('/indicators/:ticker', async (req, res, next) => {
  try {
    logMarketRequest(req);
    const ticker = req.params.ticker.toUpperCase();
    if (!ticker) {
      return res.status(400).json({ error: 'Ticker is required' });
    }
    const window = req.query.window ? Number(req.query.window) : 50;
    const { data, fetchedAt, fromCache } = await fetchWithCache(
      'indicators',
      { ticker, window },
      120_000,
      () => getMassiveIndicators(ticker, window),
      { ticker }
    );
    res.json({ ...data, fetchedAt, cache: fromCache ? 'hit' : 'miss' });
  } catch (error) {
    next(error);
  }
});

router.get('/watchlist', async (req, res, next) => {
  try {
    logMarketRequest(req);
    const raw = String(req.query.tickers ?? '');
    const tickers = raw
      .split(',')
      .map(token => token.trim().toUpperCase())
      .filter(Boolean);
    if (!tickers.length) {
      return res.status(400).json({ error: 'tickers query parameter is required' });
    }
    const unique = Array.from(new Set(tickers)).slice(0, 25);
    const entries = await Promise.all(
      unique.map(async symbol => {
        const isOptionContract = symbol.startsWith('O:');
        const type = isOptionContract ? 'watchlist-contract' : 'watchlist-underlying';
        try {
          const { data, fetchedAt, fromCache } = await fetchWithCache<any>(
            type,
            { ticker: symbol },
            30_000,
            () => (isOptionContract ? getMassiveOptionContractSnapshot(symbol) : getMassiveOptionsSnapshot(symbol)),
            { ticker: symbol }
          );
          return {
            ...data,
            entryType: isOptionContract ? ('contract' as const) : ('underlying' as const),
            fetchedAt,
            cache: fromCache ? 'hit' : 'miss'
          };
        } catch (error: any) {
          return {
            ticker: symbol,
            entryType: isOptionContract ? ('contract' as const) : ('underlying' as const),
            error: error?.response?.data?.error ?? error?.message ?? 'Failed to load snapshot'
          };
        }
      })
    );
    console.log('[SERVER] Watchlist snapshots resolved', { tickers: unique, entries });
    res.json({ entries });
  } catch (error) {
    next(error);
  }
});

export default router;
