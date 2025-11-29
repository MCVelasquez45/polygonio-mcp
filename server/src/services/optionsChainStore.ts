import { Collection } from 'mongodb';
import { getCollection } from './mongo';

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

function getSnapshotsCollection() {
  if (!collection) {
    collection = getCollection<OptionChainSnapshotDocument>(COLLECTION_NAME);
  }
  return collection;
}

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
  await ensureSnapshotIndexes();
  const normalizedUnderlying = underlying.toUpperCase();
  const col = getSnapshotsCollection();
  const doc = await col.findOne({ underlying: normalizedUnderlying, expiration });
  if (!doc) return null;
  const age = Date.now() - doc.updatedAt.getTime();
  if (age > maxAgeMs) {
    return null;
  }
  const minLimit = options.minLimit ?? 0;
  const cachedLimit = typeof doc.limit === 'number' ? doc.limit : 0;
  if (minLimit > 0 && cachedLimit < minLimit) {
    return null;
  }
  return doc;
}

export async function saveChainSnapshot(
  underlying: string,
  expiration: string,
  data: any,
  options: { limit?: number } = {}
): Promise<void> {
  await ensureSnapshotIndexes();
  const normalizedUnderlying = underlying.toUpperCase();
  const now = new Date();
  const col = getSnapshotsCollection();
  const limit = typeof options.limit === 'number' ? options.limit : undefined;
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
}
