import { AnyBulkWriteOperation, Collection } from 'mongodb';
import { getCollection } from '../../../shared/db/mongo';

type Timespan = 'minute' | 'hour' | 'day';

export type StoredAggregateBar = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap?: number | null;
  transactions?: number | null;
};

type AggregateBarDocument = StoredAggregateBar & {
  ticker: string;
  multiplier: number;
  timespan: Timespan;
  updatedAt: Date;
  source?: 'massive' | 'mongo';
};

const COLLECTION_NAME = 'option_aggregates';
let indexesEnsured = false;

function aggregatesCollection(): Collection<AggregateBarDocument> {
  return getCollection<AggregateBarDocument>(COLLECTION_NAME);
}

export async function ensureAggregateIndexes(): Promise<void> {
  if (indexesEnsured) return;
  const collection = aggregatesCollection();
  await collection.createIndex(
    { ticker: 1, timespan: 1, multiplier: 1, timestamp: 1 },
    { unique: true, name: 'ticker_timeframe_timestamp' }
  );
  await collection.createIndex({ updatedAt: 1 }, { name: 'updated_at' });
  indexesEnsured = true;
}

export async function upsertAggregateBars(
  ticker: string,
  multiplier: number,
  timespan: Timespan,
  bars: StoredAggregateBar[],
  options: { source?: 'massive' | 'mongo' } = {}
): Promise<void> {
  if (!bars.length) return;
  await ensureAggregateIndexes();
  const collection = aggregatesCollection();
  const operations: AnyBulkWriteOperation<AggregateBarDocument>[] = bars.map(bar => ({
    updateOne: {
      filter: { ticker, multiplier, timespan, timestamp: bar.timestamp },
      update: {
        $set: {
          ticker,
          multiplier,
          timespan,
          timestamp: bar.timestamp,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume,
          vwap: bar.vwap ?? null,
          transactions: bar.transactions ?? null,
          source: options.source ?? 'massive',
          updatedAt: new Date()
        }
      },
      upsert: true
    }
  }));
  await collection.bulkWrite(operations, { ordered: false });
}

export async function getRecentAggregateBars(
  ticker: string,
  multiplier: number,
  timespan: Timespan,
  window: number
): Promise<StoredAggregateBar[]> {
  await ensureAggregateIndexes();
  const docs = await aggregatesCollection()
    .find({ ticker, multiplier, timespan })
    .sort({ timestamp: -1 })
    .limit(window)
    .toArray();
  return docs.reverse().map(doc => ({
    timestamp: doc.timestamp,
    open: doc.open,
    high: doc.high,
    low: doc.low,
    close: doc.close,
    volume: doc.volume,
    vwap: doc.vwap ?? null,
    transactions: doc.transactions ?? null
  }));
}
