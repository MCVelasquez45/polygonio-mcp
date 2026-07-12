import axios from 'axios';
import { isRetryableMassiveError, resolveMassiveRetryDelayMs } from '../../shared/data/massiveRetry';

export type MassiveTimespan = 'minute' | 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';

export type NormalizedMarketBar = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type ProviderRequest = {
  ticker: string;
  multiplier: number;
  timespan: MassiveTimespan;
  from: string;
  to: string;
};

type CacheEntry = {
  expiresAt: number;
  value: NormalizedMarketBar[];
};

type MassiveAggregatesResponse = {
  results?: Array<Record<string, unknown>>;
  next_url?: string;
};

const MASSIVE_BASE_URL = process.env.MASSIVE_BASE_URL || 'https://api.massive.com';
const MASSIVE_API_KEY = process.env.MASSIVE_API_KEY ?? '';
const MASSIVE_TIMEOUT_MS = Math.max(1_000, Number(process.env.MASSIVE_TIMEOUT_MS ?? 10_000));
const MASSIVE_CACHE_TTL_MS = Math.max(1_000, Number(process.env.MASSIVE_BACKTEST_CACHE_TTL_MS ?? 60_000));
const MASSIVE_MAX_RETRIES = Math.max(0, Number(process.env.MASSIVE_BACKTEST_MAX_RETRIES ?? 2));
const MASSIVE_MAX_PAGES = Math.max(1, Number(process.env.MASSIVE_BACKTEST_MAX_PAGES ?? 20));
const MASSIVE_RETRY_BASE_MS = Math.max(100, Number(process.env.MASSIVE_RETRY_BASE_MS ?? 500));
const MASSIVE_RETRY_MAX_MS = Math.max(MASSIVE_RETRY_BASE_MS, Number(process.env.MASSIVE_RETRY_MAX_MS ?? 5_000));

const client = axios.create({
  baseURL: MASSIVE_BASE_URL,
  timeout: MASSIVE_TIMEOUT_MS
});

const barCache = new Map<string, CacheEntry>();

function buildCacheKey(args: ProviderRequest) {
  return [args.ticker.toUpperCase(), args.multiplier, args.timespan, args.from, args.to].join(':');
}

function getCachedBars(key: string) {
  const entry = barCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    barCache.delete(key);
    return null;
  }
  return entry.value.map(bar => ({ ...bar }));
}

function setCachedBars(key: string, value: NormalizedMarketBar[]) {
  barCache.set(key, {
    expiresAt: Date.now() + MASSIVE_CACHE_TTL_MS,
    value: value.map(bar => ({ ...bar }))
  });
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function assertApiKey() {
  if (!MASSIVE_API_KEY) {
    throw new Error('MASSIVE_API_KEY is not configured.');
  }
}

function stripWhitespace(value: string) {
  return value.replace(/\s+/g, '');
}

function normalizeOptionTicker(ticker: string) {
  const normalized = stripWhitespace(ticker).toUpperCase();
  return normalized.startsWith('O:') ? normalized : `O:${normalized}`;
}

function normalizeTicker(ticker: string) {
  const normalized = stripWhitespace(ticker).toUpperCase();
  if (!normalized) {
    throw new Error('ticker is required.');
  }
  return normalized;
}

function parseNumericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber)) {
      return asNumber;
    }
    const asDate = Date.parse(trimmed);
    if (Number.isFinite(asDate)) {
      return asDate;
    }
  }
  return null;
}

function normalizeBar(row: Record<string, unknown>): NormalizedMarketBar | null {
  const timestamp = parseNumericValue(row.t ?? row.timestamp);
  const open = parseNumericValue(row.o ?? row.open);
  const high = parseNumericValue(row.h ?? row.high);
  const low = parseNumericValue(row.l ?? row.low);
  const close = parseNumericValue(row.c ?? row.close);
  const volume = parseNumericValue(row.v ?? row.volume);

  if (timestamp == null || open == null || high == null || low == null || close == null || volume == null) {
    return null;
  }

  return {
    timestamp,
    open,
    high,
    low,
    close,
    volume
  };
}

async function requestAggregatesPage(
  url: string,
  params: Record<string, unknown> | undefined,
  attempt = 0
): Promise<MassiveAggregatesResponse> {
  try {
    const { data } = await client.get<MassiveAggregatesResponse>(url, {
      params: {
        ...params,
        apiKey: MASSIVE_API_KEY
      },
      headers: {
        Authorization: `Bearer ${MASSIVE_API_KEY}`,
        'X-API-Key': MASSIVE_API_KEY
      }
    });
    return data ?? {};
  } catch (error) {
    // Shared authoritative retry policy: 429 (honoring Retry-After) + transient
    // 5xx / network timeouts. See shared/data/massiveRetry.ts.
    if (isRetryableMassiveError(error, attempt, MASSIVE_MAX_RETRIES)) {
      const delayMs = resolveMassiveRetryDelayMs(error, attempt, {
        baseMs: MASSIVE_RETRY_BASE_MS,
        maxMs: MASSIVE_RETRY_MAX_MS
      });
      await delay(delayMs);
      return requestAggregatesPage(url, params, attempt + 1);
    }

    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const detail = typeof error.response?.data === 'object' && error.response?.data && 'error' in error.response.data
        ? String((error.response.data as Record<string, unknown>).error)
        : error.message;
      throw new Error(`Massive aggregates request failed (${status ?? 'unknown'}): ${detail}`);
    }

    throw error;
  }
}

async function fetchBars(args: ProviderRequest): Promise<NormalizedMarketBar[]> {
  assertApiKey();

  const cacheKey = buildCacheKey(args);
  const cached = getCachedBars(cacheKey);
  if (cached) {
    return cached;
  }

  let nextUrl = `/v2/aggs/ticker/${args.ticker}/range/${args.multiplier}/${args.timespan}/${args.from}/${args.to}`;
  let pageParams: Record<string, unknown> | undefined = {
    adjusted: true,
    sort: 'asc',
    limit: 50_000
  };
  const seenPageUrls = new Set<string>();
  const bars: NormalizedMarketBar[] = [];

  for (let page = 0; page < MASSIVE_MAX_PAGES && nextUrl; page += 1) {
    if (seenPageUrls.has(nextUrl)) {
      throw new Error('Massive pagination loop detected.');
    }
    seenPageUrls.add(nextUrl);

    const payload = await requestAggregatesPage(nextUrl, pageParams);
    const rows = Array.isArray(payload.results) ? payload.results : [];

    for (const row of rows) {
      if (typeof row !== 'object' || row === null) {
        continue;
      }
      const normalized = normalizeBar(row as Record<string, unknown>);
      if (!normalized) {
        continue;
      }
      bars.push(normalized);
    }

    nextUrl = typeof payload.next_url === 'string' && payload.next_url.trim() ? payload.next_url : '';
    pageParams = undefined;
  }

  const normalizedBars = bars
    .slice()
    .sort((left, right) => left.timestamp - right.timestamp)
    .filter((bar, index, list) => index === 0 || bar.timestamp !== list[index - 1].timestamp);

  if (bars.length > 0 && normalizedBars.length === 0) {
    throw new Error('Massive aggregates response contained malformed bar data.');
  }

  setCachedBars(cacheKey, normalizedBars);
  return normalizedBars;
}

export async function getStockBars(args: ProviderRequest): Promise<NormalizedMarketBar[]> {
  return fetchBars({
    ...args,
    ticker: normalizeTicker(args.ticker)
  });
}

export async function getOptionBars(args: ProviderRequest): Promise<NormalizedMarketBar[]> {
  return fetchBars({
    ...args,
    ticker: normalizeOptionTicker(args.ticker)
  });
}

export function clearMassiveBarsCache() {
  barCache.clear();
}
