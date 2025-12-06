import axios from 'axios';
// Generates the per-symbol checklist that powers the Entry Checklist panel.
import { Collection } from 'mongodb';
import { getCollection } from '../../../shared/db/mongo';
import {
  getRecentAggregateBars,
  StoredAggregateBar,
  upsertAggregateBars
} from '../../market/services/aggregatesStore';
import {
  getMassiveOptionContract,
  getMassiveOptionsSnapshot,
  getOptionAggregates,
  massiveGet
} from '../../../shared/data/massive';

const FASTAPI_BASE_URL =
  process.env.FASTAPI_BASE_URL || process.env.AGENT_API_URL || process.env.FASTAPI_URL || '';
const CHECKLIST_COLLECTION = 'options_entry_checklist';
const CHECKLIST_TTL_MS = Number(process.env.CHECKLIST_TTL_MS ?? 10 * 60 * 1000);
const FED_BLOCK_WINDOW_MS = Number(process.env.CHECKLIST_FED_BLOCK_WINDOW_MS ?? 2 * 24 * 60 * 60 * 1000);
const MINUTE_WINDOW = Number(process.env.CHECKLIST_MINUTE_WINDOW ?? 240); // 4h of 1m bars
const DAILY_WINDOW = Number(process.env.CHECKLIST_DAILY_WINDOW ?? 200);
const CONTEXT_SYMBOLS = ['SPY', 'QQQ', 'VIX'];

export type ChecklistItem = {
  label: string;
  passed: boolean;
};

export type ChecklistCategory = {
  key: string;
  label: string;
  score: number;
  max: number;
  items: ChecklistItem[];
};

export type ChecklistFactor = {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
};

export type ChecklistResult = {
  symbol: string;
  referenceContract?: string | null;
  price: number | null;
  emaShort: number | null;
  emaMedium: number | null;
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
  categories: ChecklistCategory[];
  totalScore: number;
  maxScore: number;
  grade: ChecklistGrade;
  qualifies: boolean;
  updatedAt: string;
  factors: ChecklistFactor[];
};

type ChecklistDocument = Omit<ChecklistResult, 'updatedAt'> & { updatedAt: Date };

export type ChecklistGrade = 'A+' | 'A' | 'B' | 'C';

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

let checklistCollection: Collection<ChecklistDocument> | null = null;
let indexesEnsured = false;

function collection(): Collection<ChecklistDocument> {
  if (!checklistCollection) {
    checklistCollection = getCollection<ChecklistDocument>(CHECKLIST_COLLECTION);
  }
  return checklistCollection;
}

// Sets up symbol + updatedAt indexes once per process so lookups are fast.
async function ensureIndexes() {
  if (indexesEnsured) return;
  await collection().createIndex({ symbol: 1 }, { unique: true, name: 'symbol_unique' });
  await collection().createIndex({ updatedAt: 1 }, { name: 'updated_at' });
  indexesEnsured = true;
}

function ema(values: number[], period: number): number | null {
  if (!values.length || period <= 1) return null;
  let emaValue = values[0];
  const k = 2 / (period + 1);
  for (let i = 1; i < values.length; i += 1) {
    emaValue = values[i] * k + emaValue * (1 - k);
  }
  return Number.isFinite(emaValue) ? emaValue : null;
}

function computeRSI(values: number[], period = 14): number | null {
  if (values.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const delta = values[i] - values[i - 1];
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  let rs = avgGain / avgLoss;
  let rsi = 100 - 100 / (1 + rs);
  for (let i = period + 1; i < values.length; i += 1) {
    const delta = values[i] - values[i - 1];
    if (delta >= 0) {
      avgGain = (avgGain * (period - 1) + delta) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - delta) / period;
    }
    rs = avgLoss === 0 ? 0 : avgGain / avgLoss;
    rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
  }
  return Number.isFinite(rsi) ? rsi : null;
}

function computeMACD(values: number[], fast = 12, slow = 26, signalPeriod = 9) {
  if (!values.length) return null;
  let emaFast = values[0];
  let emaSlow = values[0];
  let signal = 0;
  const kFast = 2 / (fast + 1);
  const kSlow = 2 / (slow + 1);
  const kSignal = 2 / (signalPeriod + 1);
  let macd = 0;
  for (const price of values) {
    emaFast = emaFast + kFast * (price - emaFast);
    emaSlow = emaSlow + kSlow * (price - emaSlow);
    macd = emaFast - emaSlow;
    signal = signal + kSignal * (macd - signal);
  }
  return { macd, signal, histogram: macd - signal };
}

function computeVWAP(bars: StoredAggregateBar[]): number | null {
  let cumulativeVolume = 0;
  let cumulativePrice = 0;
  for (const bar of bars) {
    const volume = bar.volume ?? 0;
    if (!volume) continue;
    const typical = (bar.high + bar.low + bar.close) / 3;
    cumulativePrice += typical * volume;
    cumulativeVolume += volume;
  }
  return cumulativeVolume > 0 ? cumulativePrice / cumulativeVolume : null;
}

function aggregateBars(bars: StoredAggregateBar[], multiplier: number): StoredAggregateBar[] {
  if (multiplier <= 1 || !bars.length) return bars;
  const sorted = bars.slice().sort((a, b) => a.timestamp - b.timestamp);
  const bucketMs = multiplier * 60_000;
  const map = new Map<number, StoredAggregateBar>();
  for (const bar of sorted) {
    const bucketStart = Math.floor(bar.timestamp / bucketMs) * bucketMs;
    const existing = map.get(bucketStart);
    if (!existing) {
      map.set(bucketStart, {
        timestamp: bucketStart,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume ?? 0,
        vwap: bar.vwap ?? null,
        transactions: bar.transactions ?? null
      });
    } else {
      existing.high = Math.max(existing.high, bar.high);
      existing.low = Math.min(existing.low, bar.low);
      existing.close = bar.close;
      existing.volume = (existing.volume ?? 0) + (bar.volume ?? 0);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp);
}

// Tries Massive's sentiment endpoint first (cheaper/faster) before falling back to our agent.
async function fetchMassiveSentiment(symbol: string): Promise<SentimentSnapshot | null> {
  try {
    const payload = await massiveGet(
      `/v1/sentiment/${symbol.toUpperCase()}`,
      {},
      { cacheTtlMs: 30_000 }
    );
    const raw = Array.isArray(payload?.results)
      ? payload.results[0]
      : payload?.result ?? payload ?? null;
    if (!raw) return null;
    const score =
      typeof raw.score === 'number'
        ? raw.score
        : typeof raw.sentiment_score === 'number'
        ? raw.sentiment_score
        : typeof raw.probability === 'number'
        ? raw.probability
        : typeof raw.net_sentiment === 'number'
        ? raw.net_sentiment
        : null;
    const label =
      raw.label ??
      raw.sentiment ??
      (typeof score === 'number'
        ? score >= 0.2
          ? 'bullish'
          : score <= -0.2
          ? 'bearish'
          : 'neutral'
        : null);
    return { label, score };
  } catch (error) {
    console.warn('[CHECKLIST] massive sentiment fetch failed', { symbol, error: (error as Error)?.message });
    return null;
  }
}

async function fetchSentiment(symbol: string): Promise<SentimentSnapshot | null> {
  const massiveSentiment = await fetchMassiveSentiment(symbol);
  if (massiveSentiment) return massiveSentiment;
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
    if (Array.isArray(data.events)) return data.events;
    if (Array.isArray(data)) return data;
    return [];
  } catch (error) {
    console.warn('[CHECKLIST] fed calendar fetch failed', { error: (error as Error)?.message });
    return [];
  }
}

function gradeSetup(percent: number): ChecklistGrade {
  if (percent >= 0.9) return 'A+';
  if (percent >= 0.8) return 'A';
  if (percent >= 0.6) return 'B';
  return 'C';
}

function flattenCategories(categories: ChecklistCategory[]): ChecklistFactor[] {
  return categories.flatMap(category =>
    category.items.map(item => ({
      key: `${category.key}:${item.label}`,
      label: `${category.label} · ${item.label}`,
      passed: item.passed,
      detail: item.label
    }))
  );
}

// Loads/syncs daily bars, backfilling from Massive if local cache is stale.
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
    console.warn('[CHECKLIST] failed to backfill daily aggregates', { symbol: upper, error });
  }
  return bars;
}

// Loads minute bars with fallback to Massive. Used for intraday analytics.
async function loadMinuteBars(symbol: string, window: number): Promise<StoredAggregateBar[]> {
  const upper = symbol.toUpperCase();
  let bars = await getRecentAggregateBars(upper, 1, 'minute', window);
  if (bars.length >= window) return bars;
  try {
    const remote = await getOptionAggregates(upper, 1, 'minute', window);
    if (Array.isArray(remote?.results) && remote.results.length) {
      await upsertAggregateBars(
        upper,
        1,
        'minute',
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
      bars = await getRecentAggregateBars(upper, 1, 'minute', window);
    }
  } catch (error) {
    console.warn('[CHECKLIST] failed to backfill minute aggregates', { symbol: upper, error });
  }
  return bars;
}

function deriveSupportResistance(bars: StoredAggregateBar[], lookback = 30) {
  if (!bars.length) return { support: null, resistance: null };
  const recent = bars.slice(-lookback);
  if (!recent.length) return { support: null, resistance: null };
  const lows = recent.map(bar => bar.low).filter(value => typeof value === 'number');
  const highs = recent.map(bar => bar.high).filter(value => typeof value === 'number');
  if (!lows.length || !highs.length) return { support: null, resistance: null };
  return { support: Math.min(...lows), resistance: Math.max(...highs) };
}

function boolToScore(passed: boolean) {
  return passed ? 1 : 0;
}

function evaluateTrend(args: {
  price: number | null;
  ema21: number | null;
  ema50: number | null;
  ema200: number | null;
  fiveMinute: StoredAggregateBar[];
  fifteenMinute: StoredAggregateBar[];
  hourly: StoredAggregateBar[];
  vwap: number | null;
}): ChecklistCategory {
  const items: ChecklistItem[] = [];
  const { price, ema21, ema50, ema200, fiveMinute, fifteenMinute, hourly, vwap } = args;
  const priceAbove21 = Boolean(price != null && ema21 != null && price > ema21);
  const emaStacked = Boolean(ema21 != null && ema50 != null && ema21 > ema50);
  const emaLongStack = Boolean(ema50 != null && ema200 != null && ema50 > ema200);
  const vwapTrend = Boolean(price != null && vwap != null && price >= vwap);

  const fiveUp = checkSequentialHigher(fiveMinute.slice(-3));
  const fifteenUp = checkSequentialHigher(fifteenMinute.slice(-3));
  const hourlyUp = checkSequentialHigher(hourly.slice(-2));

  items.push({ label: 'Price above EMA21', passed: priceAbove21 });
  items.push({ label: 'EMA21 > EMA50', passed: emaStacked });
  items.push({ label: 'EMA50 > EMA200', passed: emaLongStack });
  items.push({ label: '5m structure higher highs', passed: fiveUp });
  items.push({ label: '15m + 1h trending up', passed: fifteenUp && hourlyUp });
  items.push({ label: 'Above intraday VWAP', passed: vwapTrend });

  const score = items.reduce((sum, item) => sum + boolToScore(item.passed), 0);
  return { key: 'trend', label: 'Trend Structure', items, score, max: items.length };
}

function evaluateMomentum(args: {
  minuteBars: StoredAggregateBar[];
  rsiValue: number | null;
  macdHistogram: number | null;
}): ChecklistCategory {
  const { minuteBars, rsiValue, macdHistogram } = args;
  const lastBar = minuteBars.at(-1);
  const prevBar = minuteBars.at(-2);
  const avgVolume = averageVolume(minuteBars.slice(-30));
  const volumeSurge = lastBar && avgVolume ? (lastBar.volume ?? 0) > avgVolume * 1.2 : false;
  const candleRange =
    lastBar && prevBar ? lastBar.close > prevBar.close && lastBar.close > lastBar.open : false;

  const items: ChecklistItem[] = [
    { label: 'RSI above 55', passed: typeof rsiValue === 'number' ? rsiValue >= 55 : false },
    { label: 'MACD histogram positive', passed: typeof macdHistogram === 'number' ? macdHistogram > 0 : false },
    { label: 'Volume > 20% avg', passed: volumeSurge },
    { label: 'Momentum candle', passed: candleRange }
  ];
  const score = items.reduce((sum, item) => sum + boolToScore(item.passed), 0);
  return { key: 'momentum', label: 'Momentum', items, score, max: items.length };
}

function evaluateLiquidity(args: {
  spread: number | null;
  price: number | null;
  openInterest: number | null;
  volume: number | null;
  delta: number | null;
}): ChecklistCategory {
  const spreadPct =
    args.spread != null && args.price
      ? Math.abs(args.spread / Math.max(args.price, 0.01)) * 100
      : null;
  const items: ChecklistItem[] = [
    {
      label: 'Spread under 15% or $0.15',
      passed:
        args.spread != null
          ? args.spread <= 0.15 || (spreadPct != null ? spreadPct <= 15 : false)
          : false
    },
    { label: 'Open interest ≥ 500', passed: (args.openInterest ?? 0) >= 500 },
    { label: 'Delta between 0.5 and 0.85', passed: typeof args.delta === 'number' ? Math.abs(args.delta) >= 0.5 && Math.abs(args.delta) <= 0.9 : false },
    { label: 'Volume ≥ 200 contracts', passed: (args.volume ?? 0) >= 200 }
  ];
  const score = items.reduce((sum, item) => sum + boolToScore(item.passed), 0);
  return { key: 'liquidity', label: 'Options Liquidity', items, score, max: items.length };
}

function evaluateMarketContext(args: {
  snapshots: Record<string, Awaited<ReturnType<typeof getMassiveOptionsSnapshot>> | null>;
}): ChecklistCategory {
  const spy = args.snapshots.SPY;
  const qqq = args.snapshots.QQQ;
  const vix = args.snapshots.VIX;
  const items: ChecklistItem[] = [
    { label: 'SPY trend positive', passed: (spy?.changePercent ?? 0) > 0 },
    { label: 'QQQ trend positive', passed: (qqq?.changePercent ?? 0) > 0 },
    { label: 'VIX falling or flat', passed: (vix?.changePercent ?? 0) <= 0 },
    {
      label: 'Underlying outperforming SPY',
      passed:
        spy?.changePercent != null && args.snapshots?.TARGET?.changePercent != null
          ? args.snapshots.TARGET!.changePercent! >= spy.changePercent
          : true
    }
  ];
  const score = items.reduce((sum, item) => sum + boolToScore(item.passed), 0);
  return { key: 'market', label: 'Market Context', items, score, max: items.length };
}

function evaluateSupportResistance(args: {
  price: number | null;
  support: number | null;
  resistance: number | null;
}): ChecklistCategory {
  const { price, support, resistance } = args;
  const supportDistance =
    price != null && support != null && price > 0 ? (price - support) / price : null;
  const resistanceBuffer =
    price != null && resistance != null && resistance > price ? (resistance - price) / price : null;
  const items: ChecklistItem[] = [
    { label: 'Price holding above support (≥1%)', passed: supportDistance != null ? supportDistance >= 0.01 : false },
    { label: 'Room to resistance ≥3%', passed: resistanceBuffer != null ? resistanceBuffer >= 0.03 : false }
  ];
  const score = items.reduce((sum, item) => sum + boolToScore(item.passed), 0);
  return { key: 'levels', label: 'Support / Resistance', items, score, max: items.length };
}

function evaluateVolumeProfile(args: {
  vwap: number | null;
  price: number | null;
  volumeTrendUp: boolean;
}): ChecklistCategory {
  const items: ChecklistItem[] = [
    { label: 'Trading above VWAP', passed: args.price != null && args.vwap != null ? args.price >= args.vwap : false },
    { label: 'Volume trend rising', passed: args.volumeTrendUp }
  ];
  const score = items.reduce((sum, item) => sum + boolToScore(item.passed), 0);
  return { key: 'volumeProfile', label: 'Volume Profile', items, score, max: items.length };
}

function evaluateEntryTrigger(args: {
  price: number | null;
  resistance: number | null;
  fiveMinute: StoredAggregateBar[];
  fifteenMinute: StoredAggregateBar[];
}): ChecklistCategory {
  const { price, resistance, fiveMinute, fifteenMinute } = args;
  const breakout = price != null && resistance != null ? price >= resistance * 0.995 : false;
  const fiveMomentum = fiveMinute.length >= 2 ? fiveMinute.at(-1)!.close > fiveMinute.at(-2)!.close : false;
  const fifteenMomentum = fifteenMinute.length >= 2 ? fifteenMinute.at(-1)!.close > fifteenMinute.at(-2)!.close : false;
  const items: ChecklistItem[] = [
    { label: 'Break-and-retest near resistance', passed: breakout },
    { label: '5m continuation candle', passed: fiveMomentum },
    { label: '15m confirmation', passed: fifteenMomentum }
  ];
  const score = items.reduce((sum, item) => sum + boolToScore(item.passed), 0);
  return { key: 'entry', label: 'Entry Trigger', items, score, max: items.length };
}

function evaluateRisk(args: {
  price: number | null;
  support: number | null;
  resistance: number | null;
}): ChecklistCategory {
  const { price, support, resistance } = args;
  const stopDistance = price != null && support != null ? price - support : null;
  const reward = price != null && resistance != null ? resistance - price : null;
  const ratio = stopDistance && reward ? reward / stopDistance : null;
  const items: ChecklistItem[] = [
    { label: 'Defined stop (support identified)', passed: stopDistance != null && stopDistance > 0 },
    { label: 'Reward ≥ 2× risk', passed: ratio != null ? ratio >= 2 : false }
  ];
  const score = items.reduce((sum, item) => sum + boolToScore(item.passed), 0);
  return { key: 'risk', label: 'Risk Management', items, score, max: items.length };
}

function averageVolume(bars: StoredAggregateBar[]) {
  if (!bars.length) return null;
  const sum = bars.reduce((acc, bar) => acc + (bar.volume ?? 0), 0);
  return sum / bars.length;
}

function checkSequentialHigher(bars: StoredAggregateBar[]) {
  if (bars.length < 2) return false;
  for (let i = 1; i < bars.length; i += 1) {
    if (bars[i].close <= bars[i - 1].close) {
      return false;
    }
  }
  return true;
}

// Pulls Massive snapshots for TARGET, SPY, QQQ, VIX to enrich the checklist.
async function fetchContextSnapshots(targetSymbol: string) {
  const symbols = Array.from(new Set(['TARGET', ...CONTEXT_SYMBOLS]));
  const entries = await Promise.all(
    symbols.map(async key => {
      try {
        if (key === 'TARGET') {
          return [key, await getMassiveOptionsSnapshot(targetSymbol)];
        }
        return [key, await getMassiveOptionsSnapshot(key)];
      } catch (error) {
        console.warn('[CHECKLIST] context snapshot failed', { key, error });
        return [key, null];
      }
    })
  );
  return Object.fromEntries(entries) as Record<string, Awaited<ReturnType<typeof getMassiveOptionsSnapshot>> | null>;
}

/**
 * Main checklist entry point. Attempts to reuse cached documents unless
 * `force` is true or the TTL has expired. Computes every category and stores
 * the result for subsequent requests.
 */
export async function evaluateChecklist(symbolInput: string, opts: { force?: boolean } = {}): Promise<ChecklistResult> {
  const symbol = symbolInput.toUpperCase();
  await ensureIndexes();
  if (!opts.force) {
    const existing = await collection().findOne({ symbol });
    if (existing && Date.now() - existing.updatedAt.getTime() < CHECKLIST_TTL_MS) {
      return {
        ...existing,
        updatedAt: existing.updatedAt.toISOString()
      };
    }
  }

  const [dailyBars, minuteBars, sentiment, fedEvents, snapshots] = await Promise.all([
    loadDailyBars(symbol, DAILY_WINDOW),
    loadMinuteBars(symbol, MINUTE_WINDOW),
    fetchSentiment(symbol),
    fetchFedCalendar(),
    fetchContextSnapshots(symbol)
  ]);

  const closes = dailyBars.map(bar => bar.close).filter(value => typeof value === 'number');
  const ema21 = ema(closes, 21);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const { support, resistance } = deriveSupportResistance(dailyBars, 30);
  const price = snapshots.TARGET?.price ?? closes.at(-1) ?? null;

  const fiveMinute = aggregateBars(minuteBars, 5);
  const fifteenMinute = aggregateBars(minuteBars, 15);
  const hourly = aggregateBars(minuteBars, 60);
  const rsiValue = computeRSI(minuteBars.map(bar => bar.close));
  const macd = computeMACD(minuteBars.map(bar => bar.close));
  const vwap = computeVWAP(minuteBars);
  const avgVolume = averageVolume(minuteBars.slice(-40));
  const volumeTrendUp = Boolean(avgVolume && minuteBars.at(-1)?.volume && minuteBars.at(-1)!.volume! > avgVolume);

  const referenceContract = snapshots.TARGET?.referenceContract ?? null;
  const contractDetail = referenceContract
    ? await getMassiveOptionContract(referenceContract).catch(() => null)
    : null;
  const delta = contractDetail?.greeks?.delta ?? null;
  const iv = contractDetail?.impliedVolatility ?? snapshots.TARGET?.iv ?? null;
  const openInterest = contractDetail?.openInterest ?? snapshots.TARGET?.openInterest ?? null;
  const contractVolume = snapshots.TARGET?.volume ?? null;
  const bid = contractDetail?.lastQuote?.bid ?? null;
  const ask = contractDetail?.lastQuote?.ask ?? null;
  const spread = bid != null && ask != null ? Math.max(0, ask - bid) : null;

  const upcomingFed = fedEvents.find(event => {
    if (!event?.date) return false;
    const timestamp = Date.parse(event.date);
    return Number.isFinite(timestamp) && timestamp >= Date.now() && timestamp - Date.now() <= FED_BLOCK_WINDOW_MS;
  });

  const trend = evaluateTrend({ price, ema21, ema50, ema200, fiveMinute, fifteenMinute, hourly, vwap });
  const momentum = evaluateMomentum({ minuteBars, rsiValue, macdHistogram: macd?.histogram ?? null });
  const liquidity = evaluateLiquidity({ spread, price, openInterest, volume: contractVolume, delta });
  const market = evaluateMarketContext({ snapshots });
  const sr = evaluateSupportResistance({ price, support, resistance });
  const volumeProfile = evaluateVolumeProfile({ vwap, price, volumeTrendUp });
  const entry = evaluateEntryTrigger({ price, resistance, fiveMinute, fifteenMinute });
  const risk = evaluateRisk({ price, support, resistance });

  const categories = [trend, momentum, liquidity, market, sr, volumeProfile, entry, risk];
  const totalScore = categories.reduce((sum, cat) => sum + cat.score, 0);
  const maxScore = categories.reduce((sum, cat) => sum + cat.max, 0);
  const percent = maxScore ? totalScore / maxScore : 0;
  const grade = gradeSetup(percent);
  const qualifies = percent >= 0.8;

  const doc: ChecklistDocument = {
    symbol,
    referenceContract,
    price,
    emaShort: ema21 ?? null,
    emaMedium: ema50 ?? null,
    emaLong: ema200 ?? null,
    support: support ?? null,
    resistance: resistance ?? null,
    optionMetrics: {
      delta: delta ?? null,
      iv: iv ?? null,
      volume: contractVolume ?? null,
      openInterest: openInterest ?? null,
      spread: spread ?? null
    },
    sentiment: sentiment ?? null,
    fedEvent: upcomingFed ?? null,
    categories,
    totalScore,
    maxScore,
    grade,
    qualifies,
    factors: flattenCategories(categories),
    updatedAt: new Date()
  };

  await collection().updateOne({ symbol }, { $set: doc }, { upsert: true });
  return {
    ...doc,
    updatedAt: doc.updatedAt.toISOString()
  };
}

// Convenience helper for `/api/analysis/checklist` to fetch multiple symbols.
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
  if (!doc) return null;
  return {
    ...doc,
    updatedAt: doc.updatedAt.toISOString()
  };
}
