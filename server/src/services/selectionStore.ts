import { Collection } from 'mongodb';
import { getCollection } from './mongo';

export type OptionSelectionDocument = {
  userId: string;
  ticker: string;
  contract: string;
  expiration?: string;
  strike?: number;
  type?: 'call' | 'put';
  side?: 'buy' | 'sell';
  updatedAt: Date;
};

const COLLECTION_NAME = 'option_selections';
let selectionCollection: Collection<OptionSelectionDocument> | null = null;
let indexesEnsured = false;

function getSelectionCollection() {
  if (!selectionCollection) {
    selectionCollection = getCollection<OptionSelectionDocument>(COLLECTION_NAME);
  }
  return selectionCollection;
}

export async function ensureSelectionIndexes() {
  if (indexesEnsured) return;
  const collection = getSelectionCollection();
  await collection.createIndex({ userId: 1 }, { unique: true });
  indexesEnsured = true;
}

export async function getLatestSelection(userId: string) {
  await ensureSelectionIndexes();
  const collection = getSelectionCollection();
  return collection.findOne({ userId });
}

export async function saveSelection(userId: string, payload: Partial<OptionSelectionDocument>) {
  if (!userId) {
    throw new Error('userId is required');
  }
  if (!payload?.ticker || !payload?.contract) {
    throw new Error('ticker and contract are required');
  }
  await ensureSelectionIndexes();
  const collection = getSelectionCollection();
  const document: OptionSelectionDocument = {
    userId,
    ticker: payload.ticker,
    contract: payload.contract,
    expiration: payload.expiration,
    strike: typeof payload.strike === 'number' ? payload.strike : undefined,
    type: payload.type === 'call' || payload.type === 'put' ? payload.type : undefined,
    side: payload.side === 'sell' ? 'sell' : 'buy',
    updatedAt: new Date()
  };
  await collection.updateOne({ userId }, { $set: document }, { upsert: true });
  return document;
}
