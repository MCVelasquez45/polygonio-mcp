import { createHash } from 'node:crypto';
import { Collection } from 'mongodb';
import { getCollection, isMongoReady } from '../../../shared/db/mongo';

// Mongo-backed cache for rate-limited Massive endpoints. Each cache entry is
// keyed by a deterministic hash of the request parameters so different callers
// hitting the same endpoint reuse the same document.

type MarketCacheDocument<T = any> = {
  key: string;
  type: string;
  ticker?: string;
  params: Record<string, any>;
  data: T;
  fetchedAt: Date;
  expiresAt: Date;
};

type CacheFetchResult<T> = {
  data: T;
  fetchedAt: Date;
  fromCache: boolean;
};

const COLLECTION_NAME = 'market_cache';
let indexesEnsured = false;
const inflightCacheFetches = new Map<string, Promise<CacheFetchResult<any>>>();

function marketCacheCollection(): Collection<MarketCacheDocument> {
  return getCollection<MarketCacheDocument>(COLLECTION_NAME);
}

// Ensures params objects have stable ordering before hashing, so `{a:1,b:2}`
// and `{b:2,a:1}` generate the same key.
function normalizeValue(value: any): any {
  if (Array.isArray(value)) {
    return value.map(entry => normalizeValue(entry));
  }
  if (value && typeof value === 'object') {
    const sortedKeys = Object.keys(value).sort();
    return sortedKeys.reduce<Record<string, any>>((acc, key) => {
      const normalized = normalizeValue(value[key]);
      if (normalized !== undefined) {
        acc[key] = normalized;
      }
      return acc;
    }, {});
  }
  return value;
}

function createParamsHash(value: Record<string, any>): string {
  const normalized = normalizeValue(value);
  return createHash('sha1').update(JSON.stringify(normalized)).digest('hex');
}

function logMarketCacheEvent(event: string, payload: Record<string, any>) {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      service: 'market-cache',
      event,
      ...payload,
    })
  );
}

// Lazily creates the TTL + unique indexes that keep the cache bounded.
export async function ensureMarketCacheIndexes(): Promise<void> {
  if (indexesEnsured) return;
  if (!isMongoReady()) return;
  const collection = marketCacheCollection();
  await collection.createIndex({ key: 1 }, { unique: true });
  await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  indexesEnsured = true;
}

/**
 * Wraps a fetcher with cache semantics. If a fresh document exists, returns it.
 * Otherwise the fetcher is executed, stored, and returned. Callers pass a
 * `type` (e.g., `trades`), the original params payload, a TTL, and a function
 * that performs the remote fetch.
 */
export async function fetchWithCache<T>(
  type: string,
  params: Record<string, any>,
  ttlMs: number,
  fetcher: () => Promise<T>,
  options?: { ticker?: string }
): Promise<CacheFetchResult<T>> {
  const normalizedParams = normalizeValue(params);
  const key = `${type}:${createParamsHash(normalizedParams)}`;

  // When MongoDB is not available, skip persistence but still deduplicate
  // simultaneous misses inside this process.
  if (!isMongoReady()) {
    const inflight = inflightCacheFetches.get(key);
    if (inflight) {
      logMarketCacheEvent('INFLIGHT_DEDUPED', { type, ticker: options?.ticker ?? null });
      return inflight as Promise<CacheFetchResult<T>>;
    }
    const run = (async () => {
      const data = await fetcher();
      return { data, fetchedAt: new Date(), fromCache: false };
    })();
    inflightCacheFetches.set(key, run);
    try {
      return await run;
    } finally {
      inflightCacheFetches.delete(key);
    }
  }

  await ensureMarketCacheIndexes();
  const now = new Date();
  const collection = marketCacheCollection();

  const cachedDoc = await collection.findOne({ key, expiresAt: { $gt: now } });
  if (cachedDoc) {
    logMarketCacheEvent('CACHE_HIT', { type, ticker: options?.ticker ?? null, ageMs: now.getTime() - cachedDoc.fetchedAt.getTime() });
    return { data: cachedDoc.data as T, fetchedAt: cachedDoc.fetchedAt, fromCache: true };
  }

  const inflight = inflightCacheFetches.get(key);
  if (inflight) {
    logMarketCacheEvent('INFLIGHT_DEDUPED', { type, ticker: options?.ticker ?? null });
    return inflight as Promise<CacheFetchResult<T>>;
  }

  const run = (async () => {
    logMarketCacheEvent('CACHE_MISS', { type, ticker: options?.ticker ?? null, ttlMs });
    const data = await fetcher();
    const fetchedAt = new Date();
    const expiresAt = new Date(fetchedAt.getTime() + ttlMs);
    await collection.updateOne(
      { key },
      {
        $set: {
          key,
          type,
          ticker: options?.ticker,
          params: normalizedParams,
          data,
          fetchedAt,
          expiresAt
        }
      },
      { upsert: true }
    );
    return { data, fetchedAt, fromCache: false };
  })();
  inflightCacheFetches.set(key, run);
  try {
    return await run;
  } finally {
    inflightCacheFetches.delete(key);
  }
}
