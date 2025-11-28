import { createHash } from 'node:crypto';
import { Collection } from 'mongodb';
import { getCollection } from './mongo';

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

function marketCacheCollection(): Collection<MarketCacheDocument> {
  return getCollection<MarketCacheDocument>(COLLECTION_NAME);
}

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

export async function ensureMarketCacheIndexes(): Promise<void> {
  if (indexesEnsured) return;
  const collection = marketCacheCollection();
  await collection.createIndex({ key: 1 }, { unique: true });
  await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  indexesEnsured = true;
}

export async function fetchWithCache<T>(
  type: string,
  params: Record<string, any>,
  ttlMs: number,
  fetcher: () => Promise<T>,
  options?: { ticker?: string }
): Promise<CacheFetchResult<T>> {
  await ensureMarketCacheIndexes();
  const now = new Date();
  const normalizedParams = normalizeValue(params);
  const key = `${type}:${createParamsHash(normalizedParams)}`;
  const collection = marketCacheCollection();

  const cachedDoc = await collection.findOne({ key, expiresAt: { $gt: now } });
  if (cachedDoc) {
    return { data: cachedDoc.data as T, fetchedAt: cachedDoc.fetchedAt, fromCache: true };
  }

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
}

