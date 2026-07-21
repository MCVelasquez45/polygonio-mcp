import { Router } from 'express';
/**
 * Market router: exposes aggregation endpoints backed by Massive + local caches.
 * Each handler focuses on a single concern (aggregates, quotes, trades, chains) so
 * new surfaces can be slotted in without touching other modules.
 */
import {
  getMassiveQuotes,
  getMassiveIndicators,
  getMassiveTrades,
  getMassiveOptionContract,
  listMassiveOptionContracts,
  getMassiveOptionsChain,
  getMassiveOptionsSnapshot,
  getMassiveOptionContractSnapshot,
  getMassiveShortInterest,
  getMassiveShortVolume,
  listOptionExpirations,
  normalizeExpirationDate,
  clampChainLimit,
  listOptionExchanges,
  listOptionConditions,
  getMassiveStockSnapshot,
  normalizeProviderTimestamp,
} from '../../shared/data/massive';
import { REQUEST_PRIORITY } from '../../shared/data/massive';
import { getOptionChainWindow } from '../marketData/optionsMarketDataOrchestrator.service';
import { ingestRestQuote } from '../marketData/optionsQuoteCache.service';
import { fetchWithCache } from './services/marketCache';
import { getLatestSelection, saveSelection } from '../options/services/selectionStore';
import { getCachedChainSnapshot, saveChainSnapshot } from '../options/services/optionsChainStore';
import { resolveAggregates } from './services/aggregatesService';
import { addWarmTickers, getWarmTickers } from './services/aggregatesWarmList';

const router = Router();
const STABLE_CHAIN_MAX_AGE_MS = 10 * 60 * 1000;
const SHORT_INTEREST_TTL_MS = 6 * 60 * 60 * 1000;
const SHORT_VOLUME_TTL_MS = 15 * 60 * 1000;

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

function setNoStore(res: any) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
}

function countChainContracts(chain: any): number {
  if (!Array.isArray(chain?.expirations)) return 0;
  return chain.expirations.reduce((total: number, group: any) => {
    if (!Array.isArray(group?.strikes)) return total;
    return (
      total +
      group.strikes.reduce((count: number, row: any) => count + (row?.call ? 1 : 0) + (row?.put ? 1 : 0), 0)
    );
  }, 0);
}

// GET /api/market/aggs – high-level candle endpoint used by the chart.
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
    const aggregates = await resolveAggregates({
      ticker,
      multiplier,
      timespan: timespan === 'minute' || timespan === 'hour' || timespan === 'day' ? (timespan as 'minute' | 'hour' | 'day') : 'day',
      window,
      from: typeof req.query.from === 'string' ? req.query.from : null,
      to: typeof req.query.to === 'string' ? req.query.to : null
    });
    setNoStore(res);
    res.json({
      ticker: aggregates.ticker,
      interval: aggregates.interval,
      marketClosed: aggregates.marketClosed,
      afterHours: aggregates.afterHours,
      usingLastSession: aggregates.usingLastSession,
      resultGranularity: aggregates.resultGranularity,
      marketStatus: aggregates.marketStatus,
      results: aggregates.results,
      health: aggregates.health,
      fetchedAt: aggregates.fetchedAt,
      cache: aggregates.cache,
      note: aggregates.note
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/market/aggs/warm – add tickers to the aggregates warm list.
router.post('/aggs/warm', async (req, res) => {
  const tickers = Array.isArray(req.body?.tickers) ? req.body.tickers : [];
  addWarmTickers(tickers);
  res.json({ tickers: getWarmTickers() });
});

// GET /api/market/trades/:ticker – thin proxy to Massive trades with caching.
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
      2_000,
      () => getMassiveTrades(ticker, limit, order),
      { ticker }
    );
    setNoStore(res);
    res.json({ ...data, fetchedAt, cache: fromCache ? 'hit' : 'miss' });
  } catch (error) {
    next(error);
  }
});

// GET /api/market/quotes/:ticker – retrieves latest quote snapshot.
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
      1_500,
      async () => {
        const quote = await getMassiveQuotes(ticker, { limit, order });
        if (!quote) {
          throw Object.assign(new Error('Quote not found'), { status: 404 });
        }
        ingestRestQuote({
          symbol: ticker,
          bid: typeof quote.bidPrice === 'number' ? quote.bidPrice : null,
          ask: typeof quote.askPrice === 'number' ? quote.askPrice : null,
          bidSize: typeof quote.bidSize === 'number' ? quote.bidSize : null,
          askSize: typeof quote.askSize === 'number' ? quote.askSize : null,
          providerTimestamp: normalizeProviderTimestamp(quote.updated ?? quote.timestamp ?? null),
        });
        return quote;
      },
      { ticker }
    );
    setNoStore(res);
    res.json({ ...data, fetchedAt, cache: fromCache ? 'hit' : 'miss' });
  } catch (error) {
    next(error);
  }
});

// GET /api/market/options/chain/:ticker – fetches/caches large option chains.
router.get('/options/chain/:ticker', async (req, res, next) => {
  try {
    logMarketRequest(req);
    const ticker = req.params.ticker.toUpperCase();
    const limit = Number(req.query.limit) || 50;
    const rawExpiration =
      typeof req.query.expiration === 'string' && req.query.expiration.trim().length
        ? String(req.query.expiration)
        : undefined;
    const expirationFilter = rawExpiration ? normalizeExpirationDate(rawExpiration) ?? undefined : undefined;
    if (rawExpiration && !expirationFilter) {
      console.warn('[MARKET] invalid expiration filter provided, ignoring', { rawExpiration });
    }
    const desiredLimit = expirationFilter ? Math.max(limit, 5000) : limit;
    const clampedDesiredLimit = clampChainLimit(desiredLimit);

    let underlyingSymbol = ticker;
    let resolvedContractDetail: Awaited<ReturnType<typeof getMassiveOptionContract>> | null = null;

    if (ticker.startsWith('O:')) {
      resolvedContractDetail = await getMassiveOptionContract(ticker);
      if (!resolvedContractDetail?.underlying) {
        const err: any = new Error('Contract not found or missing underlying');
        err.status = 404;
        throw err;
      }
      underlyingSymbol = resolvedContractDetail.underlying.toUpperCase();
    }

    if (expirationFilter) {
      const cachedSnapshot = await getCachedChainSnapshot(
        underlyingSymbol,
        expirationFilter,
        STABLE_CHAIN_MAX_AGE_MS,
        { minLimit: clampedDesiredLimit }
      );
      if (cachedSnapshot) {
        return res.json({
          ...cachedSnapshot.data,
          fetchedAt: cachedSnapshot.updatedAt,
          cache: 'stable'
        });
      }
    }

    const { data, fetchedAt, fromCache } = await fetchWithCache(
      'options-chain',
      { ticker, limit, expiration: expirationFilter },
      120_000,
      async () => {
        // All chain fetches flow through the shared Options Market Data
        // Orchestrator (request coalescing + session-aware caching +
        // completeness metadata). The UI is a VISIBLE_UI priority consumer.
        const chainUnderlying = ticker.startsWith('O:') ? underlyingSymbol : ticker;
        const contractLimit = ticker.startsWith('O:') && expirationFilter ? Math.max(limit, 5000) : desiredLimit;
        const chain = await getOptionChainWindow({
          underlying: chainUnderlying,
          expiration: expirationFilter,
          limit: clampChainLimit(contractLimit),
          priority: REQUEST_PRIORITY.VISIBLE_UI
        });
        if (
          expirationFilter &&
          (!Array.isArray(chain?.expirations) ||
            !chain.expirations.some(group => group?.expiration === expirationFilter))
        ) {
          const err: any = new Error('No contracts for selected expiration');
          err.status = 404;
          throw err;
        }
        console.log('[MARKET] options chain resolved', {
          ticker,
          limit,
          expirations: Array.isArray(chain?.expirations) ? chain.expirations.length : 0,
          complete: chain.completeness?.complete ?? null,
          cacheStatus: chain.cacheStatus
        });
        return chain;
      },
      { ticker }
    );
    if (expirationFilter) {
      try {
        const snapshotCoverage =
          typeof data?.metadata?.referenceContracts === 'number'
            ? data.metadata.referenceContracts
            : typeof data?.metadata?.limit === 'number'
              ? data.metadata.limit
              : clampedDesiredLimit;
        await saveChainSnapshot(underlyingSymbol, expirationFilter, data, { limit: snapshotCoverage });
      } catch (error) {
        console.warn('[MARKET] failed to persist chain snapshot', { underlyingSymbol, expirationFilter }, error);
      }
    }
    const expirationCount = Array.isArray(data?.expirations) ? data.expirations.length : 0;
    const contractCount = countChainContracts(data);
    if (expirationCount === 0 || contractCount === 0) {
      console.warn(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          service: 'market-route',
          event: 'OPTIONS_CHAIN_EMPTY_RESPONSE',
          ticker,
          underlying: underlyingSymbol,
          expiration: expirationFilter ?? null,
          requestedLimit: limit,
          effectiveLimit: clampedDesiredLimit,
          cache: fromCache ? 'hit' : 'miss',
          expirationCount,
          contractCount,
          completeness: data?.completeness ?? null,
          metadata: data?.metadata ?? null,
        })
      );
    }
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
        try {
          return await getMassiveOptionContractSnapshot(symbol);
        } catch (snapshotError) {
          const detail = await getMassiveOptionContract(symbol);
          if (!detail) {
            const err: any = new Error('Contract not found');
            err.status = 404;
            throw err;
          }
          return detail;
        }
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

async function persistOptionSelection(req: any, res: any, next: any) {
  try {
    const body = req.body ?? {};
    const userId = typeof body.userId === 'string' && body.userId.trim().length ? body.userId : 'default';
    const ticker =
      typeof body.ticker === 'string'
        ? body.ticker.trim().toUpperCase()
        : typeof body.selectedTicker === 'string'
          ? body.selectedTicker.trim().toUpperCase()
          : '';
    const contract =
      typeof body.contract === 'string'
        ? body.contract.trim().toUpperCase()
        : typeof body.selectedContract === 'string'
          ? body.selectedContract.trim().toUpperCase()
          : typeof body.contractSymbol === 'string'
            ? body.contractSymbol.trim().toUpperCase()
            : '';
    const expiration = typeof body.expiration === 'string' ? body.expiration : undefined;
    const rawStrike = typeof body.strike === 'number' ? body.strike : Number(body.strike);
    const strike = Number.isFinite(rawStrike) ? rawStrike : undefined;
    const rawType = String(body.type ?? body.optionType ?? body.callPut ?? '').toLowerCase();
    const type: 'call' | 'put' | undefined = rawType === 'call' || rawType === 'put' ? rawType : undefined;
    const side: 'buy' | 'sell' = body.side === 'sell' ? 'sell' : 'buy';
    if (!ticker || !contract) {
      return res.status(400).json({ error: 'ticker and contract are required' });
    }
    const document = await saveSelection(userId, { ticker, contract, expiration, strike, type, side });
    res.json({ selection: document });
  } catch (error) {
    next(error);
  }
}

router.post('/options/selection', persistOptionSelection);
router.put('/options/selection', persistOptionSelection);
router.post('/options/select', persistOptionSelection);
router.put('/options/select', persistOptionSelection);

router.get('/reference/exchanges', async (req, res, next) => {
  try {
    logMarketRequest(req);
    const { data, fetchedAt, fromCache } = await fetchWithCache(
      'reference-exchanges',
      {},
      86_400_000,
      () => listOptionExchanges({ asset_class: 'options', locale: 'us' }),
      {}
    );
    res.json({ exchanges: data ?? [], fetchedAt, cache: fromCache ? 'hit' : 'miss' });
  } catch (error) {
    next(error);
  }
});

router.get('/reference/conditions', async (req, res, next) => {
  try {
    logMarketRequest(req);
    const limit = Number(req.query.limit ?? 200) || 200;
    const order = typeof req.query.order === 'string' ? req.query.order : 'asc';
    const sort = typeof req.query.sort === 'string' ? req.query.sort : 'type';
    const { data, fetchedAt, fromCache } = await fetchWithCache(
      'reference-conditions',
      { limit, order, sort },
      86_400_000,
      () => listOptionConditions({ asset_class: 'options', limit, order, sort }),
      {}
    );
    res.json({ conditions: data ?? [], fetchedAt, cache: fromCache ? 'hit' : 'miss' });
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
    if (!Array.isArray(data.expirations) || data.expirations.length === 0) {
      console.warn(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          service: 'market-route',
          event: 'OPTIONS_EXPIRATIONS_EMPTY_RESPONSE',
          requestedTicker,
          underlying: underlyingTicker,
          limit,
          maxPages,
          cache: fromCache ? 'hit' : 'miss',
        })
      );
    }
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
            () =>
              isOptionContract
                ? getMassiveOptionContractSnapshot(symbol, {
                    priority: REQUEST_PRIORITY.WATCHLIST,
                    cacheTtlMs: 60_000,
                  })
                : getMassiveStockSnapshot(symbol, {
                    priority: REQUEST_PRIORITY.WATCHLIST,
                    cacheTtlMs: 60_000,
                  }),
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

router.get('/short-interest', async (req, res, next) => {
  try {
    logMarketRequest(req);
    const requestedTicker = String(req.query.ticker ?? '').trim().toUpperCase();
    if (!requestedTicker) {
      return res.status(400).json({ error: 'ticker is required' });
    }
    let ticker = requestedTicker;
    if (requestedTicker.startsWith('O:')) {
      const contractDetail = await getMassiveOptionContract(requestedTicker);
      if (!contractDetail?.underlying) {
        return res.status(404).json({ error: 'Option contract missing underlying ticker' });
      }
      ticker = contractDetail.underlying.toUpperCase();
    }
    const from = typeof req.query.from === 'string' && req.query.from.trim() ? req.query.from.trim() : undefined;
    const to = typeof req.query.to === 'string' && req.query.to.trim() ? req.query.to.trim() : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const sort = typeof req.query.sort === 'string' ? req.query.sort : undefined;
    const order = req.query.order === 'asc' ? 'asc' : req.query.order === 'desc' ? 'desc' : undefined;

    const { data, fetchedAt, fromCache } = await fetchWithCache(
      'short-interest',
      { ticker, from, to, limit, sort, order },
      SHORT_INTEREST_TTL_MS,
      () => getMassiveShortInterest({ ticker, from, to, limit, sort, order }),
      { ticker }
    );
    setNoStore(res);
    res.json({
      ticker: data.ticker,
      requestedTicker,
      ...(requestedTicker !== data.ticker ? { resolvedTicker: data.ticker } : {}),
      results: data.results,
      fetchedAt,
      cache: fromCache ? 'hit' : 'miss'
    });
  } catch (error) {
    next(error);
  }
});

router.get('/short-volume', async (req, res, next) => {
  try {
    logMarketRequest(req);
    const requestedTicker = String(req.query.ticker ?? '').trim().toUpperCase();
    if (!requestedTicker) {
      return res.status(400).json({ error: 'ticker is required' });
    }
    let ticker = requestedTicker;
    if (requestedTicker.startsWith('O:')) {
      const contractDetail = await getMassiveOptionContract(requestedTicker);
      if (!contractDetail?.underlying) {
        return res.status(404).json({ error: 'Option contract missing underlying ticker' });
      }
      ticker = contractDetail.underlying.toUpperCase();
    }
    const from = typeof req.query.from === 'string' && req.query.from.trim() ? req.query.from.trim() : undefined;
    const to = typeof req.query.to === 'string' && req.query.to.trim() ? req.query.to.trim() : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const sort = typeof req.query.sort === 'string' ? req.query.sort : undefined;
    const order = req.query.order === 'asc' ? 'asc' : req.query.order === 'desc' ? 'desc' : undefined;

    const { data, fetchedAt, fromCache } = await fetchWithCache(
      'short-volume',
      { ticker, from, to, limit, sort, order },
      SHORT_VOLUME_TTL_MS,
      () => getMassiveShortVolume({ ticker, from, to, limit, sort, order }),
      { ticker }
    );
    setNoStore(res);
    res.json({
      ticker: data.ticker,
      requestedTicker,
      ...(requestedTicker !== data.ticker ? { resolvedTicker: data.ticker } : {}),
      results: data.results,
      fetchedAt,
      cache: fromCache ? 'hit' : 'miss'
    });
  } catch (error) {
    next(error);
  }
});

export default router;
