import type { OrchestratedChain } from './optionsData.types';

// In-memory snapshot-chain cache with a market-session-aware TTL policy:
// very short while the market is open (option quotes move fast), long while
// closed (the chain cannot change). Entries carry fetch + provider timestamps
// and completeness so consumers can gate on freshness honestly.

const OPEN_TTL_MS = Math.max(1_000, Number(process.env.OPTIONS_CHAIN_CACHE_OPEN_TTL_MS ?? 5_000));
const CLOSED_TTL_MS = Math.max(OPEN_TTL_MS, Number(process.env.OPTIONS_CHAIN_CACHE_CLOSED_TTL_MS ?? 5 * 60_000));
/** How long a stale entry may still be served (labeled stale) after a fetch failure. */
const STALE_GRACE_MS = Math.max(0, Number(process.env.OPTIONS_CHAIN_CACHE_STALE_GRACE_MS ?? 10 * 60_000));

type ChainCacheEntry = {
  chain: OrchestratedChain;
  cachedAt: number;
};

const cache = new Map<string, ChainCacheEntry>();

export function chainCacheTtlMs(marketOpen: boolean): number {
  return marketOpen ? OPEN_TTL_MS : CLOSED_TTL_MS;
}

export function getCachedChain(key: string, marketOpen: boolean): OrchestratedChain | null {
  const entry = cache.get(key);
  if (!entry) return null;
  const age = Date.now() - entry.cachedAt;
  if (age > chainCacheTtlMs(marketOpen)) return null;
  return { ...entry.chain, cacheStatus: 'cached', staleReason: null };
}

/** A stale entry is only served after a live fetch failed, and is labeled. */
export function getStaleChain(key: string, reason: string): OrchestratedChain | null {
  const entry = cache.get(key);
  if (!entry) return null;
  const age = Date.now() - entry.cachedAt;
  if (age > STALE_GRACE_MS) return null;
  return { ...entry.chain, cacheStatus: 'stale', staleReason: reason };
}

export function setCachedChain(key: string, chain: OrchestratedChain): void {
  cache.set(key, { chain, cachedAt: Date.now() });
}

export function chainCacheAgeMs(key: string): number | null {
  const entry = cache.get(key);
  return entry ? Date.now() - entry.cachedAt : null;
}

export function newestChainCacheAgeMs(): number | null {
  let newest: number | null = null;
  for (const entry of cache.values()) {
    const age = Date.now() - entry.cachedAt;
    if (newest == null || age < newest) newest = age;
  }
  return newest;
}

export function latestCompleteness(): OrchestratedChain['completeness'] | null {
  let newest: ChainCacheEntry | null = null;
  for (const entry of cache.values()) {
    if (!newest || entry.cachedAt > newest.cachedAt) newest = entry;
  }
  return newest?.chain.completeness ?? null;
}

export function clearChainCache(): void {
  cache.clear();
}
