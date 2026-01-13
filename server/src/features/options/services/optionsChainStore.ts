import { Collection } from 'mongodb';
import { getCollection } from '../../../shared/db/mongo';

// Stores option chain snapshots per underlying/expiration so requests are fast.

export type OptionChainSnapshotDocument = {
  underlying: string;
  expiration: string;
  data: any;
  limit?: number;
  updatedAt: Date;
  createdAt: Date;
};

const COLLECTION_NAME = 'option_chain_snapshots';
const TTL_SECONDS = 60 * 60 * 24; // 24 hours
let collection: Collection<OptionChainSnapshotDocument> | null = null;
let indexesEnsured = false;
const memorySnapshots = new Map<string, OptionChainSnapshotDocument>();

function getSnapshotKey(underlying: string, expiration: string) {
  return `${underlying.toUpperCase()}::${expiration}`;
}

function readMemorySnapshot(
  key: string,
  maxAgeMs: number,
  minLimit: number
): OptionChainSnapshotDocument | null {
  const doc = memorySnapshots.get(key);
  if (!doc) return null;
  const age = Date.now() - doc.updatedAt.getTime();
  if (age > maxAgeMs) return null;
  const cachedLimit = typeof doc.limit === 'number' ? doc.limit : 0;
  if (minLimit > 0 && cachedLimit < minLimit) return null;
  return doc;
}

function getSnapshotsCollection() {
  if (!collection) {
    collection = getCollection<OptionChainSnapshotDocument>(COLLECTION_NAME);
  }
  return collection;
}

// TTL indexes keep documents fresh; background job not required.
async function ensureSnapshotIndexes() {
  if (indexesEnsured) return;
  const col = getSnapshotsCollection();
  await col.createIndex({ underlying: 1, expiration: 1 }, { unique: true });
  await col.createIndex({ updatedAt: 1 }, { expireAfterSeconds: TTL_SECONDS });
  indexesEnsured = true;
}

export async function getCachedChainSnapshot(
  underlying: string,
  expiration: string,
  maxAgeMs: number,
  options: { minLimit?: number } = {}
): Promise<OptionChainSnapshotDocument | null> {
  const normalizedUnderlying = underlying.toUpperCase();
  const key = getSnapshotKey(normalizedUnderlying, expiration);
  const minLimit = options.minLimit ?? 0;
  try {
    await ensureSnapshotIndexes();
    const col = getSnapshotsCollection();
    const doc = await col.findOne({ underlying: normalizedUnderlying, expiration });
    if (!doc) return null;
    const age = Date.now() - doc.updatedAt.getTime();
    if (age > maxAgeMs) {
      return null;
    }
    const cachedLimit = typeof doc.limit === 'number' ? doc.limit : 0;
    if (minLimit > 0 && cachedLimit < minLimit) {
      return null;
    }
    return doc;
  } catch (error) {
    console.warn('[MARKET] option chain cache unavailable, using memory fallback', error);
    return readMemorySnapshot(key, maxAgeMs, minLimit);
  }
}

export async function saveChainSnapshot(
  underlying: string,
  expiration: string,
  data: any,
  options: { limit?: number } = {}
): Promise<void> {
  const normalizedUnderlying = underlying.toUpperCase();
  const now = new Date();
  const limit = typeof options.limit === 'number' ? options.limit : undefined;
  try {
    await ensureSnapshotIndexes();
    const col = getSnapshotsCollection();
    await col.updateOne(
      { underlying: normalizedUnderlying, expiration },
      {
        $set: {
          data,
          ...(limit != null ? { limit } : {}),
          updatedAt: now,
          underlying: normalizedUnderlying,
          expiration
        },
        $setOnInsert: { createdAt: now }
      },
      { upsert: true }
    );
  } catch (error) {
    console.warn('[MARKET] option chain cache unavailable, saving in memory', error);
    memorySnapshots.set(getSnapshotKey(normalizedUnderlying, expiration), {
      underlying: normalizedUnderlying,
      expiration,
      data,
      ...(limit != null ? { limit } : {}),
      updatedAt: now,
      createdAt: now
    });
  }
}
