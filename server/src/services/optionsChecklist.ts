import axios from 'axios';
import { Collection } from 'mongodb';
import { getCollection } from './mongo';
import { getRecentAggregateBars, StoredAggregateBar, upsertAggregateBars } from './aggregatesStore';
import { getMassiveOptionContract, getMassiveOptionsSnapshot, getOptionAggregates } from './massive';

const FASTAPI_BASE_URL =
  process.env.FASTAPI_BASE_URL || process.env.AGENT_API_URL || process.env.FASTAPI_URL || '';
const CHECKLIST_COLLECTION = 'options_entry_checklist';
const CHECKLIST_TTL_MS = Number(process.env.CHECKLIST_TTL_MS ?? 15 * 60 * 1000);
const FED_BLOCK_WINDOW_MS = Number(process.env.CHECKLIST_FED_BLOCK_WINDOW_MS ?? 2 * 24 * 60 * 60 * 1000);

type SentimentSnapshot = {
  label?: string | null;
  score?: number | null;
};

type FedEventSnapshot = {
  name?: string;
  title?: string;
  date?: string;
  impact?: string;
};

export type ChecklistFactor = {
  key: string;
  label: string;
  detail: string;
  passed: boolean;
};

export type ChecklistResult = {
  symbol: string;
  referenceContract?: string | null;
  price: number | null;
  emaShort: number | null;
  emaLong: number | null;
  support: number | null;
  resistance: number | null;
  optionMetrics: {
    delta: number | null;
    iv: number | null;
    volume: number | null;
    openInterest: number | null;
    spread: number | null;
  };
  sentiment?: SentimentSnapshot | null;
  fedEvent?: FedEventSnapshot | null;
  factors: ChecklistFactor[];
  qualifies: boolean;
  updatedAt: string;
};

type ChecklistDocument = Omit<ChecklistResult, 'updatedAt'> & {
  updatedAt: Date;
};

let checklistCollection: Collection<ChecklistDocument> | null = null;
let indexesEnsured = false;

function collection(): Collection<ChecklistDocument> {
  if (!checklistCollection) {
    checklistCollection = getCollection<ChecklistDocument>(CHECKLIST_COLLECTION);
  }
  return checklistCollection;
}

async function ensureIndexes() {
  if (indexesEnsured) return;
  await collection().createIndex({ symbol: 1 }, { unique: true, name: 'symbol_unique' });
  await collection().createIndex({ updatedAt: 1 }, { name: 'updated_at' });
  indexesEnsured = true;
}

function ema(values: number[], period: number): number | null {
  if (!values.length || period <= 1 || values.length < period) return null;
  const k = 2 / (period + 1);
  let emaValue = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let i = period; i < values.length; i += 1) {
    emaValue = values[i] * k + emaValue * (1 - k);
  }
  return Number.isFinite(emaValue) ? emaValue : null;
}

async function loadDailyBars(symbol: string, window: number): Promise<StoredAggregateBar[]> {
  const upper = symbol.toUpperCase();
  let bars = await getRecentAggregateBars(upper, 1, 'day', window);
  if (bars.length >= window) return bars;
  try {
    const remote = await getOptionAggregates(upper, 1, 'day', window);
    if (Array.isArray(remote?.results) && remote.results.length) {
      await upsertAggregateBars(
        upper,
        1,
        'day',
        remote.results.map(row => ({
          timestamp: row.timestamp,
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
          volume: row.volume ?? 0,
          vwap: row.vwap ?? null,
          transactions: row.transactions ?? null
        }))
      );
      bars = await getRecentAggregateBars(upper, 1, 'day', window);
    }
  } catch (error) {
    console.warn('[CHECKLIST] failed to backfill aggregates', { symbol: upper, error });
  }
  return bars;
}

function deriveSupportResistance(bars: StoredAggregateBar[], window: number) {
  if (!bars.length) return { support: null, resistance: null };
  const recent = bars.slice(-window);
  if (!recent.length) return { support: null, resistance: null };
  const lows = recent.map(bar => bar.low).filter(value => typeof value === 'number');
  const highs = recent.map(bar => bar.high).filter(value => typeof value === 'number');
  if (!lows.length || !highs.length) return { support: null, resistance: null };
  return {
    support: Math.min(...lows),
    resistance: Math.max(...highs)
  };
}

async function fetchSentiment(symbol: string): Promise<SentimentSnapshot | null> {
  if (!FASTAPI_BASE_URL) return null;
  try {
    const url = `${FASTAPI_BASE_URL.replace(/\/$/, '')}/sentiment/${symbol.toUpperCase()}`;
    const { data } = await axios.get(url, { timeout: 8000 });
    if (!data) return null;
    return {
      label: data.label ?? data.sentiment ?? data.tag ?? null,
      score:
        typeof data.score === 'number'
          ? data.score
          : typeof data.probability === 'number'
          ? data.probability
          : typeof data.confidence === 'number'
          ? data.confidence
          : null
    };
  } catch (error) {
    console.warn('[CHECKLIST] sentiment fetch failed', { symbol, error: (error as Error)?.message });
    return null;
  }
}

async function fetchFedCalendar(): Promise<FedEventSnapshot[]> {
  if (!FASTAPI_BASE_URL) return [];
  try {
    const url = `${FASTAPI_BASE_URL.replace(/\/$/, '')}/calendar/fed`;
    const { data } = await axios.get(url, { timeout: 8000 });
    if (!data) return [];
    if (Array.isArray(data.events)) {
      return data.events;
    }
    if (Array.isArray(data)) {
      return data;
    }
    return [];
  } catch (error) {
    console.warn('[CHECKLIST] fed calendar fetch failed', { error: (error as Error)?.message });
    return [];
  }
}

function mapDocument(doc: ChecklistDocument): ChecklistResult {
  return {
    ...doc,
    updatedAt: doc.updatedAt.toISOString()
  };
}

function buildFactor(args: {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
}): ChecklistFactor {
  return args;
}

export async function evaluateChecklist(symbolInput: string, opts: { force?: boolean } = {}): Promise<ChecklistResult> {
  const symbol = symbolInput.toUpperCase();
  await ensureIndexes();
  if (!opts.force) {
    const existing = await collection().findOne({ symbol });
    if (existing && Date.now() - existing.updatedAt.getTime() < CHECKLIST_TTL_MS) {
      return mapDocument(existing);
    }
  }

  const [bars, snapshot, sentiment, fedEvents] = await Promise.all([
    loadDailyBars(symbol, 60),
    getMassiveOptionsSnapshot(symbol).catch(() => null),
    fetchSentiment(symbol),
    fetchFedCalendar()
  ]);

  const closes = bars.map(bar => bar.close).filter(value => typeof value === 'number');
  const ema21 = ema(closes, 21);
  const ema50 = ema(closes, 50);
  const price = snapshot?.price ?? closes.at(-1) ?? null;

  const { support, resistance } = deriveSupportResistance(bars, 30);
  const supportDistance = price != null && support != null && price !== 0 ? (price - support) / price : null;
  const resistanceBuffer =
    price != null && resistance != null && price !== 0 ? (resistance - price) / price : null;

  const trendPassed = Boolean(price != null && ema21 != null && ema50 != null && price > ema21 && ema21 > ema50);
  const levelsPassed =
    typeof supportDistance === 'number' &&
    supportDistance >= 0.01 &&
    typeof resistanceBuffer === 'number' &&
    resistanceBuffer >= 0.015;

  const referenceContract = snapshot?.referenceContract ?? null;
  const contractDetail = referenceContract
    ? await getMassiveOptionContract(referenceContract).catch(() => null)
    : null;

  const delta = contractDetail?.greeks?.delta ?? null;
  const iv = contractDetail?.impliedVolatility ?? snapshot?.iv ?? null;
  const openInterest = contractDetail?.openInterest ?? snapshot?.openInterest ?? null;
  const volume = snapshot?.volume ?? null;
  const bid = contractDetail?.lastQuote?.bid ?? null;
  const ask = contractDetail?.lastQuote?.ask ?? null;
  const spread = bid != null && ask != null ? Math.max(0, ask - bid) : null;

  const deltaPassed = typeof delta === 'number' ? Math.abs(delta) >= 0.5 && Math.abs(delta) <= 0.85 : false;
  const ivPassed = typeof iv === 'number' ? iv <= 0.65 : true;
  const liquidityPassed =
    (openInterest ?? 0) >= 500 && (volume ?? 0) >= 200 && (spread == null || spread <= 0.25);
  const optionPassed = deltaPassed && ivPassed && liquidityPassed;

  const sentimentPassed =
    !sentiment || typeof sentiment.score !== 'number' ? true : sentiment.score >= -0.2;

  const now = Date.now();
  const upcomingFed =
    fedEvents.find(event => {
      if (!event?.date) return false;
      const timestamp = Date.parse(event.date);
      return Number.isFinite(timestamp) && timestamp >= now && timestamp - now <= FED_BLOCK_WINDOW_MS;
    }) ?? null;
  const fedPassed = !upcomingFed;

  const factors: ChecklistFactor[] = [
    buildFactor({
      key: 'trend',
      label: 'Trend & EMAs',
      passed: trendPassed,
      detail: price != null
        ? `Price ${price.toFixed(2)}, EMA21 ${ema21?.toFixed(2) ?? 'n/a'}, EMA50 ${ema50?.toFixed(2) ?? 'n/a'}.`
        : 'Price unavailable.'
    }),
    buildFactor({
      key: 'levels',
      label: 'Support / Resistance',
      passed: levelsPassed,
      detail:
        support != null && resistance != null
          ? `Support ${support.toFixed(2)}, resistance ${resistance.toFixed(2)}.`
          : 'Not enough history to map levels.'
    }),
    buildFactor({
      key: 'option',
      label: 'Greeks & IV Window',
      passed: optionPassed,
      detail: `Delta ${delta?.toFixed(2) ?? 'n/a'}, IV ${
        iv != null ? `${(iv * 100).toFixed(1)}%` : 'n/a'
      }, OI ${openInterest ?? 'n/a'}, spread ${spread != null ? `$${spread.toFixed(2)}` : 'n/a'}.`
    }),
    buildFactor({
      key: 'sentiment',
      label: 'Sentiment Check',
      passed: sentimentPassed,
      detail: sentiment
        ? `${sentiment.label ?? 'sentiment'} (${sentiment.score ?? 'n/a'})`
        : 'No sentiment data.'
    }),
    buildFactor({
      key: 'fed',
      label: 'Fed Calendar Risk',
      passed: fedPassed,
      detail: upcomingFed ? `Upcoming: ${upcomingFed.name ?? upcomingFed.title} (${upcomingFed.date})` : 'No events flagged.'
    })
  ];

  const qualifies = factors.every(factor => factor.passed);

  const doc: ChecklistDocument = {
    symbol,
    referenceContract,
    price,
    emaShort: ema21 ?? null,
    emaLong: ema50 ?? null,
    support: support ?? null,
    resistance: resistance ?? null,
    optionMetrics: {
      delta: delta ?? null,
      iv: iv ?? null,
      volume: volume ?? null,
      openInterest: openInterest ?? null,
      spread: spread ?? null
    },
    sentiment: sentiment ?? null,
    fedEvent: upcomingFed ?? null,
    factors,
    qualifies,
    updatedAt: new Date()
  };

  await collection().updateOne({ symbol }, { $set: doc }, { upsert: true });
  return mapDocument(doc);
}

export async function evaluateChecklistBatch(
  tickers: string[],
  options: { force?: boolean } = {}
): Promise<ChecklistResult[]> {
  const unique = Array.from(new Set(tickers.map(ticker => ticker.toUpperCase()))).filter(Boolean);
  const results = await Promise.all(
    unique.map(symbol =>
      evaluateChecklist(symbol, options).catch(error => {
        console.warn('[CHECKLIST] evaluation failed', { symbol, error });
        return null;
      })
    )
  );
  return results.filter((entry): entry is ChecklistResult => Boolean(entry));
}

export async function getStoredChecklist(symbolInput: string): Promise<ChecklistResult | null> {
  const symbol = symbolInput.toUpperCase();
  await ensureIndexes();
  const doc = await collection().findOne({ symbol });
  return doc ? mapDocument(doc) : null;
}
