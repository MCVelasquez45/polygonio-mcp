import {
  fetchSnapshotOptions,
  getMassiveOptionsChain,
  normalizeProviderTimestamp,
  REQUEST_PRIORITY,
  type RequestPriority,
} from '../../shared/data/massive';
import type { UnderlyingContext } from './optionsData.types';
import { getMarketStatusSnapshot } from '../market/services/marketStatus';
import { expirationWindowForDte } from '../../shared/time/tradingCalendar';
import {
  getCachedChain,
  getStaleChain,
  setCachedChain,
} from './optionsChainCache.service';
import { REFERENCE_CACHE_TTL_MS } from './optionsContractCache.service';
import { ingestRestQuote } from './optionsQuoteCache.service';
import { recordOptionsRestFailure, recordOptionsRestSuccess } from './optionsDataHealth.service';
import type {
  ChainCompleteness,
  ChainWindowRequest,
  OrchestratedChain,
} from './optionsData.types';

// The single server-side owner of option-chain market data (Options Advanced
// alignment). Every consumer — the Phase 2B decision engine, the scanner, the
// dashboard chain browser, contract detail — requests normalized data here.
// Nothing else may call Massive for chains.
//
// Guarantees:
//  * request coalescing: equivalent concurrent requests share ONE fetch
//  * narrow provider queries (expiration window / type / strike range) instead
//    of downloading the whole chain and filtering locally
//  * session-aware snapshot TTLs; long-lived reference caching
//  * explicit ChainCompleteness on every response
//  * delayed underlying context is surfaced with its provider timestamp and
//    timeframe — it can never masquerade as a real-time quote

const inflight = new Map<string, Promise<OrchestratedChain>>();

function normalizeRequest(request: ChainWindowRequest): Required<Pick<ChainWindowRequest, 'underlying'>> & ChainWindowRequest {
  return {
    ...request,
    underlying: request.underlying.trim().toUpperCase(),
    expiration: request.expiration ?? undefined,
    expirationGte: request.expirationGte ?? undefined,
    expirationLte: request.expirationLte ?? undefined,
    contractType: request.contractType ?? undefined,
    strikeGte: typeof request.strikeGte === 'number' ? Number(request.strikeGte.toFixed(4)) : undefined,
    strikeLte: typeof request.strikeLte === 'number' ? Number(request.strikeLte.toFixed(4)) : undefined,
    limit: request.limit ?? 250,
  };
}

/** Coalescing key: everything that changes the provider query. Priority does not. */
function requestKey(request: ChainWindowRequest): string {
  return [
    request.underlying,
    request.expiration ?? '',
    request.expirationGte ?? '',
    request.expirationLte ?? '',
    request.contractType ?? 'both',
    request.strikeGte ?? '',
    request.strikeLte ?? '',
    request.limit ?? 250,
  ].join('|');
}

function buildCompleteness(metadata: Record<string, any>): ChainCompleteness {
  const snapshotComplete = metadata.snapshotComplete === true;
  const referenceComplete = metadata.referenceComplete === true;
  const truncated = !snapshotComplete || !referenceComplete;
  return {
    complete: !truncated,
    snapshotPagesFetched: Number(metadata.snapshotPages ?? 0),
    referencePagesFetched: Number(metadata.referencePages ?? 0),
    snapshotNextCursor: metadata.snapshotNextCursor ?? null,
    referenceNextCursor: metadata.referenceNextCursor ?? null,
    truncated,
    truncationReason: truncated
      ? !snapshotComplete
        ? 'SNAPSHOT_PAGE_BUDGET_EXHAUSTED'
        : 'REFERENCE_PAGE_BUDGET_EXHAUSTED'
      : null,
    coveredExpirationStart: metadata.coveredExpirationStart ?? null,
    coveredExpirationEnd: metadata.coveredExpirationEnd ?? null,
    fetchedAt: typeof metadata.fetchedAt === 'string' ? metadata.fetchedAt : new Date().toISOString(),
  };
}

/** Hydrate the quote cache from chain legs so REST is the WS fallback source. */
function hydrateQuoteCache(chain: OrchestratedChain): void {
  for (const group of chain.expirations) {
    for (const row of group.strikes) {
      for (const side of ['call', 'put'] as const) {
        const leg = row[side];
        if (!leg?.ticker) continue;
        const providerTimestamp = normalizeProviderTimestamp(
          leg?.snapshot?.last_quote?.last_updated ??
            leg?.lastTrade?.sip_timestamp ??
            null
        );
        ingestRestQuote({
          symbol: String(leg.ticker),
          bid: typeof leg.bid === 'number' ? leg.bid : null,
          ask: typeof leg.ask === 'number' ? leg.ask : null,
          providerTimestamp,
        });
      }
    }
  }
}

async function fetchChainWindow(request: ChainWindowRequest, key: string): Promise<OrchestratedChain> {
  const priority = request.priority ?? REQUEST_PRIORITY.VISIBLE_UI;
  const response: any = await getMassiveOptionsChain(
    request.underlying,
    request.limit ?? 250,
    'asc',
    'ticker',
    {
      expiration: request.expiration,
      expirationGte: request.expirationGte,
      expirationLte: request.expirationLte,
      contractType: request.contractType,
      strikeGte: request.strikeGte,
      strikeLte: request.strikeLte,
      priority,
      referenceCacheTtlMs: REFERENCE_CACHE_TTL_MS,
      // The orchestrator's session-aware chain cache is the single snapshot
      // cache; don't double-cache pages inside massiveGet.
      snapshotCacheTtlMs: 0,
    }
  );

  const completeness = buildCompleteness(response?.metadata ?? {});
  const chain: OrchestratedChain = {
    ticker: response?.ticker ?? request.underlying,
    underlyingPrice: response?.underlyingPrice ?? null,
    underlyingContext: response?.underlyingContext ?? null,
    expirations: Array.isArray(response?.expirations) ? response.expirations : [],
    completeness,
    cacheStatus: 'fresh',
    staleReason: null,
    metadata: response?.metadata ?? {},
  };

  hydrateQuoteCache(chain);
  setCachedChain(key, chain);
  recordOptionsRestSuccess(chain.underlyingContext?.lastUpdated ?? null);

  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      service: 'options-market-data',
      event: 'CHAIN_FETCH_COMPLETE',
      underlying: chain.ticker,
      requestedExpirationStart: request.expirationGte ?? request.expiration ?? null,
      requestedExpirationEnd: request.expirationLte ?? request.expiration ?? null,
      snapshotPagesFetched: completeness.snapshotPagesFetched,
      referencePagesFetched: completeness.referencePagesFetched,
      contractsNormalized: chain.expirations.reduce((acc, group) => acc + group.strikes.length, 0),
      complete: completeness.complete,
      cacheStatus: chain.cacheStatus,
    })
  );

  return chain;
}

/**
 * Fetch (or serve from cache) a normalized option-chain window.
 * Concurrent equivalent requests share one in-flight provider operation.
 */
export async function getOptionChainWindow(rawRequest: ChainWindowRequest): Promise<OrchestratedChain> {
  const request = normalizeRequest(rawRequest);
  const key = requestKey(request);

  let marketOpen = false;
  try {
    const status = await getMarketStatusSnapshot();
    marketOpen = status.market === 'open';
  } catch {
    marketOpen = false;
  }

  const cached = getCachedChain(key, marketOpen);
  if (cached) return cached;

  const existing = inflight.get(key);
  if (existing) return existing;

  const run = (async () => {
    try {
      return await fetchChainWindow(request, key);
    } catch (error) {
      recordOptionsRestFailure((error as Error)?.message ?? 'chain fetch failed');
      const stale = getStaleChain(key, (error as Error)?.message ?? 'provider fetch failed');
      if (stale) {
        console.warn('[options-market-data] serving stale chain after fetch failure', {
          underlying: request.underlying,
          reason: stale.staleReason,
        });
        return stale;
      }
      throw error;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, run);
  return run;
}

/**
 * The automation decision engine's entry point: a direction-specific chain
 * window covering exactly the configured DTE range, strike-bounded around the
 * underlying when known. AUTOMATION_DECISION priority.
 */
export async function getAutomationChain(args: {
  underlying: string;
  direction: 'BULLISH' | 'BEARISH';
  dteMin: number;
  dteMax: number;
  underlyingPriceHint?: number | null;
  now?: number;
}): Promise<OrchestratedChain> {
  const now = args.now ?? Date.now();
  const window = expirationWindowForDte(now, args.dteMin, args.dteMax);
  const contractType = args.direction === 'BULLISH' ? 'call' : 'put';
  const hint = args.underlyingPriceHint;
  // ±12% strike window when we know the underlying: wide enough that every
  // delta-window candidate is inside, narrow enough to avoid far-OTM pages.
  const strikeGte = typeof hint === 'number' && Number.isFinite(hint) ? Math.floor(hint * 0.88) : undefined;
  const strikeLte = typeof hint === 'number' && Number.isFinite(hint) ? Math.ceil(hint * 1.12) : undefined;

  return getOptionChainWindow({
    underlying: args.underlying,
    contractType,
    expirationGte: window.gte,
    expirationLte: window.lte,
    strikeGte,
    strikeLte,
    limit: 250,
    priority: REQUEST_PRIORITY.AUTOMATION_DECISION,
  });
}

const underlyingContextCache = new Map<string, { context: UnderlyingContext; cachedAt: number }>();
const UNDERLYING_CONTEXT_TTL_MS = Math.max(1_000, Number(process.env.OPTIONS_UNDERLYING_CONTEXT_TTL_MS ?? 15_000));
const underlyingInflight = new Map<string, Promise<UnderlyingContext | null>>();

/**
 * Delayed underlying context via the smallest possible authorized call — a
 * single one-row options-snapshot page. Never a stock endpoint. The result is
 * explicitly labeled with the provider's timeframe (DELAYED under Options
 * Advanced) so it cannot masquerade as a real-time quote.
 */
export async function getUnderlyingContext(
  underlying: string,
  priority: RequestPriority = REQUEST_PRIORITY.VISIBLE_UI
): Promise<UnderlyingContext | null> {
  const symbol = underlying.trim().toUpperCase();
  const cached = underlyingContextCache.get(symbol);
  if (cached && Date.now() - cached.cachedAt < UNDERLYING_CONTEXT_TTL_MS) {
    return cached.context;
  }
  const existing = underlyingInflight.get(symbol);
  if (existing) return existing;

  const run = (async () => {
    try {
      const snapshot = await fetchSnapshotOptions(symbol, { limit: 1 }, { maxPages: 1, priority });
      const asset = snapshot.underlyingAsset;
      if (!asset) return null;
      const context: UnderlyingContext = {
        ticker: typeof asset.ticker === 'string' ? asset.ticker.toUpperCase() : symbol,
        price: typeof asset.price === 'number' && Number.isFinite(asset.price) ? asset.price : null,
        lastUpdated: normalizeProviderTimestamp(asset.last_updated),
        timeframe: typeof asset.timeframe === 'string' ? asset.timeframe.toUpperCase() : 'UNKNOWN',
        source: 'options-snapshot',
      };
      underlyingContextCache.set(symbol, { context, cachedAt: Date.now() });
      recordOptionsRestSuccess(context.lastUpdated);
      return context;
    } catch (error) {
      recordOptionsRestFailure((error as Error)?.message ?? 'underlying context fetch failed');
      return cached?.context ?? null;
    } finally {
      underlyingInflight.delete(symbol);
    }
  })();

  underlyingInflight.set(symbol, run);
  return run;
}
