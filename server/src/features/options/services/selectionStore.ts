import { Collection } from 'mongodb';
import { getCollection, isMongoReady } from '../../../shared/db/mongo';
import { expirationFromOptionSymbol } from '../../../shared/symbols/optionSymbol';
import { isExpiredContract } from '../../../shared/time/tradingCalendar';

// Persists the last per-user option selection so the UI can restore context.

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
  if (!isMongoReady()) return null;
  await ensureSelectionIndexes();
  const collection = getSelectionCollection();
  const selection = await collection.findOne({ userId });
  if (!selection) return null;
  const expiration = selection.expiration ?? expirationFromOptionSymbol(selection.contract);
  if (isExpiredContract(expiration, Date.now())) {
    // Never hand back an expired contract selection — a persisted selection
    // saved before this contract expired is a stale cached selection, not a
    // valid one to restore.
    console.warn('[OptionSelection] discarding expired persisted selection on read', {
      userId,
      contract: selection.contract,
      expiration,
    });
    return null;
  }
  return selection;
}

export async function saveSelection(userId: string, payload: Partial<OptionSelectionDocument>) {
  if (!userId) {
    throw new Error('userId is required');
  }
  if (!payload?.ticker || !payload?.contract) {
    throw new Error('ticker and contract are required');
  }
  const expiration = payload.expiration ?? expirationFromOptionSymbol(payload.contract);
  if (isExpiredContract(expiration, Date.now())) {
    throw Object.assign(new Error('Cannot persist selection for an expired contract'), { status: 422 });
  }
  if (!isMongoReady()) {
    return { userId, ticker: payload.ticker, contract: payload.contract, updatedAt: new Date() } as OptionSelectionDocument;
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
