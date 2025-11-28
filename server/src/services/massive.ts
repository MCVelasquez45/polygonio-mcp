import axios from 'axios';

const MASSIVE_API_KEY = process.env.MASSIVE_API_KEY;
const MASSIVE_BASE_URL = process.env.MASSIVE_BASE_URL || 'https://api.massive.com';
const MASSIVE_DEFAULT_CACHE_TTL_MS = Number(process.env.MASSIVE_CACHE_TTL_MS ?? 10_000);
const MASSIVE_MAX_CONCURRENT = Math.max(1, Number(process.env.MASSIVE_MAX_CONCURRENT ?? 1));
const MASSIVE_MIN_INTERVAL_MS = Math.max(0, Number(process.env.MASSIVE_MIN_INTERVAL_MS ?? 1_000));
const MASSIVE_MAX_RETRIES = Math.max(0, Number(process.env.MASSIVE_MAX_RETRIES ?? 3));
const MASSIVE_RETRY_BASE_MS = Math.max(100, Number(process.env.MASSIVE_RETRY_BASE_MS ?? 500));
const MASSIVE_RETRY_MAX_MS = Math.max(MASSIVE_RETRY_BASE_MS, Number(process.env.MASSIVE_RETRY_MAX_MS ?? 5_000));

const client = axios.create({
  baseURL: MASSIVE_BASE_URL,
  timeout: 10000
});

type MassiveResponse<T = any> = {
  status?: string;
  results?: T;
  next_url?: string;
  request_id?: string;
  [key: string]: any;
};

type MassiveRequestOptions = {
  cacheTtlMs?: number;
};

type QueueTask<T> = {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

type CacheEntry = {
  value: any;
  expiresAt: number;
  cachedAt: number;
};

const responseCache = new Map<string, CacheEntry>();
const inflightRequests = new Map<string, Promise<any>>();
const requestQueue: QueueTask<any>[] = [];
let activeRequests = 0;
let nextAvailableTimestamp = Date.now();
let scheduledDrain: NodeJS.Timeout | null = null;
const retryableStatusCodes = new Set([429, 500, 502, 503, 504]);

function stableSerialize(value: any): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(entry => stableSerialize(entry)).join(',')}]`;
  }
  const entries = Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`);
  return `{${entries.join(',')}}`;
}

function normalizeParams(input: Record<string, any>) {
  const normalized: Record<string, any> = {};
  Object.keys(input)
    .sort()
    .forEach(key => {
      const value = input[key];
      if (value === undefined) return;
      normalized[key] = value;
    });
  return normalized;
}

function buildCacheKey(path: string, params: Record<string, any>) {
  return `${path}?${stableSerialize(params)}`;
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function scheduleDrain(delay: number) {
  if (scheduledDrain) return;
  scheduledDrain = setTimeout(() => {
    scheduledDrain = null;
    drainQueue();
  }, Math.max(1, delay));
}

function drainQueue() {
  if (!requestQueue.length) return;
  if (activeRequests >= MASSIVE_MAX_CONCURRENT) return;

  const now = Date.now();
  if (now < nextAvailableTimestamp) {
    scheduleDrain(nextAvailableTimestamp - now);
    return;
  }

  const task = requestQueue.shift();
  if (!task) return;
  activeRequests += 1;
  nextAvailableTimestamp = Date.now() + MASSIVE_MIN_INTERVAL_MS;

  task
    .run()
    .then(task.resolve)
    .catch(task.reject)
    .finally(() => {
      activeRequests -= 1;
      drainQueue();
    });
}

function scheduleRequest<T>(run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    requestQueue.push({ run, resolve, reject });
    drainQueue();
  });
}

function parseRetryAfter(header: any): number | null {
  if (header == null) return null;
  if (typeof header === 'number' && Number.isFinite(header)) {
    return header * 1000;
  }
  if (typeof header === 'string') {
    const seconds = Number(header);
    if (!Number.isNaN(seconds)) {
      return seconds * 1000;
    }
    const date = new Date(header);
    if (!Number.isNaN(date.getTime())) {
      const delta = date.getTime() - Date.now();
      if (delta > 0) return delta;
    }
  }
  return null;
}

function shouldRetry(error: unknown, attempt: number) {
  if (attempt >= MASSIVE_MAX_RETRIES) return false;
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  return typeof status === 'number' && retryableStatusCodes.has(status);
}

function resolveRetryDelay(error: unknown, attempt: number) {
  const header =
    (axios.isAxiosError(error) && (error.response?.headers?.['retry-after'] ?? error.response?.headers?.['Retry-After'])) ||
    undefined;
  const headerDelay = parseRetryAfter(header);
  if (typeof headerDelay === 'number' && headerDelay > 0) {
    return Math.min(headerDelay, MASSIVE_RETRY_MAX_MS);
  }
  const backoff = MASSIVE_RETRY_BASE_MS * Math.pow(2, Math.max(0, attempt));
  return Math.min(backoff, MASSIVE_RETRY_MAX_MS);
}

async function massiveGet<T = any>(
  path: string,
  params: Record<string, any> = {},
  options?: MassiveRequestOptions
): Promise<T> {
  if (!MASSIVE_API_KEY) {
    throw new Error('MASSIVE_API_KEY is not configured');
  }
  const normalizedParams = normalizeParams(params);
  const cacheKey = buildCacheKey(path, normalizedParams);
  const ttl =
    typeof options?.cacheTtlMs === 'number' && options.cacheTtlMs >= 0
      ? options.cacheTtlMs
      : MASSIVE_DEFAULT_CACHE_TTL_MS;

  const cachedEntry = responseCache.get(cacheKey);
  const now = Date.now();
  if (ttl > 0 && cachedEntry && cachedEntry.expiresAt > now) {
    return cachedEntry.value;
  }

  if (inflightRequests.has(cacheKey)) {
    return inflightRequests.get(cacheKey)! as Promise<T>;
  }

  const requestPromise = scheduleRequest(() => executeMassiveRequest<T>(path, normalizedParams));

  inflightRequests.set(cacheKey, requestPromise);

  try {
    const payload = await requestPromise;
    if (ttl > 0) {
      responseCache.set(cacheKey, { value: payload, expiresAt: Date.now() + ttl, cachedAt: Date.now() });
    }
    return payload;
  } catch (error) {
    if (cachedEntry) {
      console.warn('[MASSIVE] returning stale cache after failure', {
        path,
        ageMs: Date.now() - cachedEntry.cachedAt,
        reason: axios.isAxiosError(error) ? error.response?.status : 'error'
      });
      return cachedEntry.value;
    }
    throw error;
  } finally {
    inflightRequests.delete(cacheKey);
  }
}

async function executeMassiveRequest<T>(
  path: string,
  normalizedParams: Record<string, any>,
  attempt: number = 0
): Promise<T> {
  try {
    console.log('[MASSIVE] GET', path, normalizedParams, { attempt: attempt + 1 });
    const { data } = await client.get<MassiveResponse<T>>(path, {
      params: {
        apiKey: MASSIVE_API_KEY,
        ...normalizedParams
      }
    });
    return (data as any) ?? {};
  } catch (error) {
    if (shouldRetry(error, attempt)) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const delayMs = resolveRetryDelay(error, attempt);
      console.warn('[MASSIVE] request failed, retrying', {
        path,
        status,
        attempt: attempt + 1,
        retryDelayMs: delayMs
      });
      await delay(delayMs);
      return executeMassiveRequest(path, normalizedParams, attempt + 1);
    }
    throw error;
  }
}

function isNotFoundError(error: unknown) {
  return axios.isAxiosError(error) && error.response?.status === 404;
}

export async function getOptionAggregates(
  optionSymbol: string,
  multiplier: number,
  timespan: string,
  window: number,
  fromDate?: string,
  toDate?: string
) {
  const symbol = optionSymbol.toUpperCase();
  const msPerUnit =
    {
      minute: 60_000,
      hour: 3_600_000,
      day: 86_400_000
    }[timespan] ?? 86_400_000;

  let from = fromDate ? new Date(fromDate) : null;
  let to = toDate ? new Date(toDate) : null;
  if (!from || Number.isNaN(from.getTime())) {
    to = new Date();
    const duration = msPerUnit * multiplier * window;
    from = new Date(to.getTime() - duration);
  }
  if (!to || Number.isNaN(to.getTime())) {
    to = new Date();
  }

  const endpoint = `/v2/aggs/ticker/${symbol}/range/${multiplier}/${timespan}/${from
    .toISOString()
    .slice(0, 10)}/${to.toISOString().slice(0, 10)}`;
  const payload = await massiveGet(
    endpoint,
    { adjusted: true, sort: 'asc', limit: window },
    { cacheTtlMs: 30_000 }
  );

  const results = Array.isArray(payload.results)
    ? payload.results.map((row: any) => ({
        timestamp: row.t ?? row.timestamp,
        open: row.o ?? row.open,
        high: row.h ?? row.high,
        low: row.l ?? row.low,
        close: row.c ?? row.close,
        volume: row.v ?? row.volume
      }))
    : [];

  console.log('[MASSIVE] aggregates resolved', {
    ticker: symbol,
    endpoint,
    count: results.length,
    from: from.toISOString(),
    to: to.toISOString()
  });

  return { ticker: symbol, results };
}

export async function getMassiveTrades(optionSymbol: string, limit = 50, order: 'asc' | 'desc' = 'desc') {
  const symbol = optionSymbol.toUpperCase();
  const payload = await massiveGet(
    `/v3/trades/${symbol}`,
    {
      order,
      limit,
      sort: 'timestamp'
    },
    { cacheTtlMs: 0 }
  );

  const trades = Array.isArray(payload.results)
    ? payload.results.map((trade: any, index: number) => ({
        id: trade.id ?? `${trade.sip_timestamp ?? index}`,
        price: trade.price,
        size: trade.size,
        timestamp: trade.sip_timestamp ?? trade.timestamp,
        exchange: trade.exchange,
        conditions: trade.conditions
      }))
    : [];

  console.log('[MASSIVE] trades resolved', {
    ticker: symbol,
    order,
    requested: limit,
    count: trades.length,
    firstTimestamp: trades[0]?.timestamp
  });

  return { ticker: symbol, trades };
}

type SortDirection = 'asc' | 'desc';

type QuoteEntry = {
  timestamp: number | null;
  bidPrice: number | null;
  askPrice: number | null;
  bidSize: number | null;
  askSize: number | null;
  bidExchange?: string;
  askExchange?: string;
  spread: number | null;
  midpoint: number | null;
};

export async function getMassiveQuotes(optionSymbol: string, opts?: { limit?: number; order?: SortDirection }) {
  const symbol = optionSymbol.toUpperCase();
  const limitParam = Number(opts?.limit ?? 1) || 1;
  const limit = Math.min(Math.max(limitParam, 1), 500);
  const order: SortDirection = opts?.order === 'asc' ? 'asc' : 'desc';
  const payload = await massiveGet(
    `/v3/quotes/${symbol}`,
    {
      order,
      limit,
      sort: 'timestamp'
    },
    { cacheTtlMs: 0 }
  );
  const rawQuotes = Array.isArray(payload.results) ? payload.results : [];
  if (!rawQuotes.length) return null;

  const normalizedQuotes: QuoteEntry[] = rawQuotes.map((quote: any) => {
    const bidPrice = quote.bid_price ?? null;
    const askPrice = quote.ask_price ?? null;
    return {
      timestamp: typeof quote.sip_timestamp === 'number' ? quote.sip_timestamp : quote.timestamp ?? null,
      bidPrice,
      askPrice,
      bidSize: quote.bid_size ?? null,
      askSize: quote.ask_size ?? null,
      bidExchange: quote.bid_exchange,
      askExchange: quote.ask_exchange,
      spread: bidPrice != null && askPrice != null ? askPrice - bidPrice : null,
      midpoint: bidPrice != null && askPrice != null ? (bidPrice + askPrice) / 2 : bidPrice ?? askPrice ?? null
    };
  });
  const activeQuote = order === 'desc' ? normalizedQuotes[0] : normalizedQuotes[normalizedQuotes.length - 1];
  if (!activeQuote) return null;

  console.log('[MASSIVE] quotes resolved', {
    ticker: symbol,
    order,
    requested: limit,
    count: normalizedQuotes.length,
    activeTimestamp: activeQuote.timestamp
  });

  return {
    ticker: symbol,
    ...activeQuote,
    updated: activeQuote.timestamp ?? undefined,
    quotes: normalizedQuotes
  };
}

export async function getMassiveOptionContract(optionSymbol: string) {
  const symbol = optionSymbol.toUpperCase();
  const payload = await massiveGet(`/v3/reference/options/contracts/${symbol}`, {}, { cacheTtlMs: 120_000 });
  const detail = payload.results ?? payload;
  if (!detail) return null;
  const normalized = normalizeOptionContractDetail(detail, symbol);
  if (normalized) {
    console.log('[MASSIVE] contract resolved', {
      ticker: normalized.ticker,
      underlying: normalized.underlying,
      expiration: normalized.expiration
    });
  }
  return normalized;
}

type OptionContractQuery = {
  limit?: number;
  order?: SortDirection;
  sort?: string;
  ticker?: string;
  underlying?: string;
  contractType?: 'call' | 'put';
  includeExpired?: boolean;
  cursor?: string;
};

export async function listMassiveOptionContracts(options: OptionContractQuery = {}) {
  const limitParam = Number(options.limit ?? 50) || 50;
  const limit = Math.min(Math.max(limitParam, 1), 1000);
  const order: SortDirection = options.order === 'desc' ? 'desc' : 'asc';
  const params: Record<string, any> = {
    limit,
    order,
    sort: options.sort ?? 'ticker'
  };
  if (options.ticker) {
    params.ticker = options.ticker.toUpperCase();
  }
  if (options.underlying) {
    const normalized = options.underlying.toUpperCase();
    params.underlying_ticker = normalized;
    params.underlying_asset = normalized;
  }
  if (options.contractType === 'call' || options.contractType === 'put') {
    params.contract_type = options.contractType;
  }
  if (options.includeExpired) {
    params.include_expired = true;
  }
  if (options.cursor) {
    params.cursor = options.cursor;
  }
  const payload = await massiveGet('/v3/reference/options/contracts', params, { cacheTtlMs: 60_000 });
  const contracts = Array.isArray(payload.results) ? payload.results : [];
  const results = contracts
    .map((contract: any) => normalizeOptionContractDetail(contract, contract?.ticker ?? ''))
    .filter(
      (contract: ReturnType<typeof normalizeOptionContractDetail> | null): contract is NonNullable<
        ReturnType<typeof normalizeOptionContractDetail>
      > => Boolean(contract)
    );
  console.log('[MASSIVE] contracts list resolved', {
    order,
    sort: params.sort,
    requested: limit,
    count: results.length,
    hasNext: Boolean(payload.next_url)
  });
  return {
    results,
    nextUrl: payload.next_url ?? null,
    requestId: payload.request_id
  };
}

export async function getMassiveOptionsChain(
  underlying: string,
  limit = 100,
  order: 'asc' | 'desc' = 'asc',
  sort: string = 'ticker'
) {
  const normalizedUnderlying = underlying.toUpperCase();
  let snapshotPayload: any;
  try {
    snapshotPayload = await massiveGet(
      `/v3/snapshot/options/${normalizedUnderlying}`,
      {
        order,
        limit,
        sort
      },
      { cacheTtlMs: 5_000 }
    );
  } catch (error) {
    console.warn('[MASSIVE] snapshot chain fetch failed for', normalizedUnderlying, error);
  }

  const snapshotResults = Array.isArray(snapshotPayload?.results) ? snapshotPayload.results : null;
  const snapshotRoot =
    snapshotResults && snapshotResults.length && (Array.isArray(snapshotResults[0]?.options) || Array.isArray(snapshotResults[0]?.contracts))
      ? snapshotResults[0]
      : snapshotPayload?.results ?? snapshotPayload ?? {};
  const underlyingAsset =
    snapshotRoot?.underlying_asset ??
    snapshotRoot?.underlying ??
    snapshotResults?.[0]?.underlying_asset ??
    snapshotResults?.[0]?.underlying ??
    {};
  const underlyingPrice = resolveNumber(underlyingAsset?.price) ?? null;
  const rawOptions = Array.isArray(snapshotRoot?.options)
    ? snapshotRoot.options
    : Array.isArray(snapshotRoot?.contracts)
    ? snapshotRoot.contracts
    : snapshotResults
    ? snapshotResults
        .map((entry: any) => entry?.option ?? entry)
        .filter(Boolean)
    : Array.isArray(snapshotRoot)
    ? snapshotRoot
    : [];

  let referenceLegs = new Map<string, any>();
  try {
    const referencePayload = await massiveGet(
      '/v3/reference/options/contracts',
      {
        underlying_asset: normalizedUnderlying,
        underlying_ticker: normalizedUnderlying,
        limit,
        order,
        sort
      },
      { cacheTtlMs: 60_000 }
    );
    const contracts = Array.isArray(referencePayload?.results) ? referencePayload.results : [];
    referenceLegs = new Map(
      contracts
        .filter((contract: any) => {
          const contractUnderlying =
            typeof contract?.underlying_ticker === 'string' ? contract.underlying_ticker.toUpperCase() : null;
          return contractUnderlying === normalizedUnderlying;
        })
        .map((contract: any) => normalizeReferenceContract(contract, normalizedUnderlying))
        .filter(Boolean)
        .map((leg: any) => [leg.ticker, leg])
    );
  } catch (error) {
    console.warn('[MASSIVE] reference contracts fetch failed for', normalizedUnderlying, error);
  }

  const expirationMap = new Map<string, Map<number, any>>();
  const seenTickers = new Set<string>();

  function upsertStrike(expiration: string, strike: number, call: any, put: any) {
    if (!expiration || Number.isNaN(strike)) return;
    const strikesForExpiration = expirationMap.get(expiration) ?? new Map<number, any>();
    const row = strikesForExpiration.get(strike) ?? { strike, call: undefined, put: undefined };
    if (call) {
      const callTicker =
        typeof call?.ticker === 'string' ? call.ticker.toUpperCase() : undefined;
      const callFallback = callTicker ? referenceLegs.get(callTicker) : undefined;
      const leg = normalizeSnapshotLeg(
        call,
        strike,
        expiration,
        'call',
        underlyingPrice,
        normalizedUnderlying,
        callFallback
      );
      if (leg) {
        row.call = leg;
        seenTickers.add(leg.ticker);
      } else if (callFallback) {
        row.call = callFallback;
        seenTickers.add(callFallback.ticker);
      }
    }
    if (put) {
      const putTicker =
        typeof put?.ticker === 'string' ? put.ticker.toUpperCase() : undefined;
      const putFallback = putTicker ? referenceLegs.get(putTicker) : undefined;
      const leg = normalizeSnapshotLeg(
        put,
        strike,
        expiration,
        'put',
        underlyingPrice,
        normalizedUnderlying,
        putFallback
      );
      if (leg) {
        row.put = leg;
        seenTickers.add(leg.ticker);
      } else if (putFallback) {
        row.put = putFallback;
        seenTickers.add(putFallback.ticker);
      }
    }
    strikesForExpiration.set(strike, row);
    expirationMap.set(expiration, strikesForExpiration);
  }

  for (const leg of referenceLegs.values()) {
    if (!leg?.ticker || seenTickers.has(leg.ticker)) continue;
    const strikesForExpiration = expirationMap.get(leg.expiration) ?? new Map<number, any>();
    const row = strikesForExpiration.get(leg.strike) ?? { strike: leg.strike, call: undefined, put: undefined };
    if (leg.type === 'call') row.call = leg;
    else row.put = leg;
    strikesForExpiration.set(leg.strike, row);
    expirationMap.set(leg.expiration, strikesForExpiration);
    seenTickers.add(leg.ticker);
  }

  for (const option of rawOptions) {
    const optionEntry = option?.option ?? option;
    const optionDetails = optionEntry?.details ?? optionEntry?.detail ?? null;
    const expiration =
      typeof optionEntry?.expiration_date === 'string'
        ? optionEntry.expiration_date
        : typeof optionEntry?.expiration === 'string'
        ? optionEntry.expiration
        : typeof optionDetails?.expiration_date === 'string'
        ? optionDetails.expiration_date
        : typeof optionDetails?.expiration === 'string'
        ? optionDetails.expiration
        : undefined;
    if (Array.isArray(optionEntry?.strikes)) {
      for (const strikeEntry of optionEntry.strikes) {
        const strike = Number(strikeEntry?.strike_price ?? strikeEntry?.strike);
        upsertStrike(expiration, strike, strikeEntry?.call, strikeEntry?.put);
      }
      continue;
    }
    const strike = Number(
      optionEntry?.strike_price ?? optionEntry?.strike ?? optionDetails?.strike_price ?? optionDetails?.strike
    );
    if (optionEntry?.call || optionEntry?.put) {
      upsertStrike(expiration, strike, optionEntry.call, optionEntry.put);
      continue;
    }
    const contractType =
      optionEntry?.contract_type ??
      optionEntry?.type ??
      optionEntry?.option_type ??
      optionDetails?.contract_type ??
      optionDetails?.type ??
      optionDetails?.option_type;
    if (contractType === 'call' || contractType === 'put') {
      const leg = normalizeSnapshotLeg(
        optionEntry,
        strike,
        expiration,
        contractType,
        underlyingPrice,
        normalizedUnderlying
      );
      if (!leg) continue;
      const strikesForExpiration = expirationMap.get(expiration) ?? new Map<number, any>();
      const row = strikesForExpiration.get(strike) ?? { strike, call: undefined, put: undefined };
      if (contractType === 'call') row.call = leg;
      else row.put = leg;
      strikesForExpiration.set(strike, row);
      expirationMap.set(expiration, strikesForExpiration);
    }
  }

  let expirations = Array.from(expirationMap.entries())
    .map(([expiration, strikes]) => ({
      expiration,
      dte: computeDte(expiration),
      strikes: Array.from(strikes.values())
        .filter(strike => strike.call || strike.put)
        .sort((a, b) => (a.strike ?? 0) - (b.strike ?? 0))
    }))
    .filter(group => group.strikes.length > 0)
    .sort((a, b) => {
      const aDate = new Date(a.expiration).getTime();
      const bDate = new Date(b.expiration).getTime();
      return aDate - bDate;
    });

  if (!expirations.length && referenceLegs.size) {
    const fallbackMap = new Map<string, Map<number, any>>();
    for (const leg of referenceLegs.values()) {
      const strikesForExpiration = fallbackMap.get(leg.expiration) ?? new Map<number, any>();
      const row = strikesForExpiration.get(leg.strike) ?? { strike: leg.strike, call: undefined, put: undefined };
      if (leg.type === 'call') row.call = leg;
      else row.put = leg;
      strikesForExpiration.set(leg.strike, row);
      fallbackMap.set(leg.expiration, strikesForExpiration);
    }
    expirations = Array.from(fallbackMap.entries())
      .map(([expiration, strikes]) => ({
        expiration,
        dte: computeDte(expiration),
        strikes: Array.from(strikes.values())
          .filter(strike => strike.call || strike.put)
          .sort((a, b) => (a.strike ?? 0) - (b.strike ?? 0))
      }))
      .filter(group => group.strikes.length > 0)
      .sort((a, b) => {
        const aDate = new Date(a.expiration).getTime();
        const bDate = new Date(b.expiration).getTime();
        return aDate - bDate;
      });
  }

  console.log('[MASSIVE] options chain resolved', {
    ticker: normalizedUnderlying,
    expirations: expirations.length,
    strikes: expirations.reduce((acc, group) => acc + group.strikes.length, 0)
  });

  return {
    ticker: normalizedUnderlying,
    underlyingPrice,
    expirations
  };
}

function resolveNumber(value: any): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function computeMid(bid: any, ask: any): number | null {
  const bidNum = resolveNumber(bid);
  const askNum = resolveNumber(ask);
  if (bidNum != null && askNum != null) {
    return (bidNum + askNum) / 2;
  }
  return bidNum ?? askNum ?? null;
}

function computeDte(expiration: string): number | null {
  const expDate = new Date(expiration);
  if (Number.isNaN(expDate.getTime())) return null;
  const diff = Math.round((expDate.getTime() - Date.now()) / 86_400_000);
  return diff;
}

function normalizeSnapshotLeg(
  raw: any,
  strike: number,
  expiration: string,
  type: 'call' | 'put',
  underlyingPrice: number | null,
  underlyingSymbol: string,
  fallback?: any
) {
  if (!raw) return null;
  const tickerCandidate =
    typeof raw?.ticker === 'string'
      ? raw.ticker
      : typeof raw?.details?.ticker === 'string'
      ? raw.details.ticker
      : typeof raw?.option?.ticker === 'string'
      ? raw.option.ticker
      : null;
  if (!tickerCandidate) return null;
  const ticker = tickerCandidate.toUpperCase();
  const priceData = raw?.price_data ?? raw?.priceData ?? raw?.pricing ?? null;
  const priceDataQuote = priceData?.last_quote ?? priceData?.quote ?? {};
  const priceDataTrade = priceData?.last_trade ?? priceData?.trade ?? {};
  const lastQuote = raw?.last_quote ?? raw?.lastQuote ?? raw?.quote ?? priceDataQuote ?? {};
  const lastTrade = raw?.last_trade ?? raw?.lastTrade ?? raw?.trade ?? priceDataTrade ?? {};
  const priceDataBid = resolveNumber(
    priceData?.bid ?? priceData?.bid_price ?? priceDataQuote?.bid ?? priceDataQuote?.bid_price
  );
  const priceDataAsk = resolveNumber(
    priceData?.ask ?? priceData?.ask_price ?? priceDataQuote?.ask ?? priceDataQuote?.ask_price
  );
  const bid =
    resolveNumber(lastQuote?.bid ?? lastQuote?.bid_price ?? raw?.bid ?? raw?.bidPrice) ?? priceDataBid ?? null;
  const ask =
    resolveNumber(lastQuote?.ask ?? lastQuote?.ask_price ?? raw?.ask ?? raw?.askPrice) ?? priceDataAsk ?? null;
  const snapshotMid = resolveNumber(
    raw?.mid ??
      raw?.mark ??
      raw?.markPrice ??
      lastQuote?.mid ??
      lastQuote?.mark ??
      lastQuote?.mid_price ??
      lastQuote?.mark_price ??
      priceData?.mid ??
      priceData?.midpoint ??
      priceData?.mark
  );
  const mid = snapshotMid ?? computeMid(bid, ask);
  const priceDataMark = resolveNumber(priceData?.mark ?? priceData?.mid ?? priceData?.price ?? priceData?.last);
  const mark = resolveNumber(raw?.mark ?? raw?.mid ?? raw?.price ?? raw?.last_price ?? priceDataMark ?? mid);
  const lastPrice =
    resolveNumber(lastTrade?.price) ??
    resolveNumber(raw?.lastPrice) ??
    resolveNumber(raw?.last_price) ??
    resolveNumber(raw?.price) ??
    resolveNumber(priceData?.last ?? priceData?.last_price ?? priceData?.close) ??
    mark ??
    mid;
  const day = raw?.day ?? raw?.stats ?? priceData?.day ?? null;
  const change = resolveNumber(
    day?.change ??
      raw?.change ??
      raw?.price_change ??
      raw?.day_change ??
      raw?.gain ??
      priceData?.change ??
      priceData?.day_change ??
      priceData?.price_change
  );
  const changePercent = resolveNumber(
    day?.change_percent ??
      raw?.change_percent ??
      raw?.day_change_percent ??
      raw?.percent_change ??
      raw?.percentGain ??
      priceData?.change_percent ??
      priceData?.percent_change
  );
  const volume = resolveNumber(
    raw?.volume ?? day?.volume ?? raw?.dayVolume ?? priceData?.volume ?? priceData?.day_volume ?? priceData?.total_volume
  );
  const openInterest = resolveNumber(
    raw?.openInterest ?? raw?.open_interest ?? day?.open_interest ?? raw?.oi ?? priceData?.open_interest ?? priceData?.openInterest
  );
  const iv = resolveNumber(
    raw?.implied_volatility ??
      raw?.impliedVolatility ??
      raw?.iv ??
      day?.implied_volatility ??
      day?.impliedVolatility ??
      priceData?.implied_volatility ??
      priceData?.iv
  );
  const greeks = {
    ...(priceData?.greeks ?? {}),
    ...(raw?.greeks ?? raw?.details?.greeks ?? {})
  };
  const delta = resolveNumber(greeks?.delta);
  const gamma = resolveNumber(greeks?.gamma);
  const theta = resolveNumber(greeks?.theta);
  const vega = resolveNumber(greeks?.vega);
  const rho = resolveNumber(greeks?.rho);
  const breakeven =
    lastPrice != null
      ? type === 'call'
        ? strike + lastPrice
        : strike - lastPrice
      : null;
  const toBreakevenPercent =
    breakeven != null && underlyingPrice != null
      ? ((breakeven - underlyingPrice) / underlyingPrice) * 100
      : null;
  const inTheMoney =
    underlyingPrice != null
      ? type === 'call'
        ? underlyingPrice >= strike
        : underlyingPrice <= strike
      : undefined;
  const sourceBreakEven = resolveNumber(
    raw?.break_even_price ??
      raw?.details?.break_even_price ??
      raw?.option?.break_even_price ??
      priceData?.breakeven ??
      priceData?.breakeven_price ??
      priceData?.break_even_price
  );
  const leg: any = {
    ticker,
    type,
    strike,
    expiration,
    underlying: underlyingSymbol,
    bid,
    ask,
    mid,
    mark: mark ?? mid ?? lastPrice,
    lastPrice,
    change,
    changePercent,
    volume,
    openInterest,
    iv,
    greeks,
    delta,
    gamma,
    theta,
    vega,
    rho,
    breakeven,
    toBreakevenPercent,
    inTheMoney,
    lastTrade: {
      price: resolveNumber(lastTrade?.price ?? lastTrade?.last_price ?? priceDataTrade?.price),
      size: resolveNumber(lastTrade?.size ?? lastTrade?.quantity ?? raw?.lastTradeSize ?? priceDataTrade?.size),
      sip_timestamp:
        lastTrade?.sip_timestamp ??
        lastTrade?.timestamp ??
        raw?.lastTradeTimestamp ??
        priceDataTrade?.sip_timestamp ??
        null
    }
  };
  if (sourceBreakEven != null) {
    leg.breakeven = sourceBreakEven;
  }

  const snapshotPayload: Record<string, any> = {
    break_even_price: sourceBreakEven,
    day: day ?? null,
    details: raw?.details ?? null,
    greeks: raw?.greeks ?? null,
    implied_volatility: iv,
    last_quote: lastQuote ?? null,
    last_trade: lastTrade ?? null,
    open_interest: resolveNumber(raw?.open_interest ?? raw?.openInterest),
    underlying_asset: raw?.underlying_asset ?? null,
    price_data: priceData ?? null
  };
  const hasSnapshotData = Object.values(snapshotPayload).some(value => value != null);
  if (hasSnapshotData) {
    leg.snapshot = snapshotPayload;
  }

  if (fallback) {
    leg.bid = leg.bid ?? fallback.bid ?? null;
    leg.ask = leg.ask ?? fallback.ask ?? null;
    leg.mid = leg.mid ?? fallback.mid ?? null;
    leg.mark = leg.mark ?? fallback.mark ?? null;
    leg.lastPrice = leg.lastPrice ?? fallback.lastPrice ?? null;
    leg.volume = leg.volume ?? fallback.volume ?? null;
    leg.openInterest = leg.openInterest ?? fallback.openInterest ?? null;
    leg.iv = leg.iv ?? fallback.iv ?? null;
    leg.change = leg.change ?? fallback.change ?? null;
    leg.changePercent = leg.changePercent ?? fallback.changePercent ?? null;
    leg.breakeven = leg.breakeven ?? fallback.breakeven ?? null;
    leg.toBreakevenPercent = leg.toBreakevenPercent ?? fallback.toBreakevenPercent ?? null;
    leg.delta = leg.delta ?? fallback.delta ?? null;
    leg.gamma = leg.gamma ?? fallback.gamma ?? null;
    leg.theta = leg.theta ?? fallback.theta ?? null;
    leg.vega = leg.vega ?? fallback.vega ?? null;
    leg.rho = leg.rho ?? fallback.rho ?? null;
    leg.greeks = { ...(fallback.greeks ?? {}), ...(leg.greeks ?? {}) };
    if (!leg.lastTrade?.price && fallback.lastTrade?.price) {
      leg.lastTrade = {
        price: fallback.lastTrade?.price ?? null,
        size: fallback.lastTrade?.size ?? null,
        sip_timestamp: fallback.lastTrade?.sip_timestamp ?? null
      };
    }
  }

  return leg;
}

function normalizeReferenceContract(contract: any, underlyingSymbol: string) {
  const ticker =
    typeof contract?.ticker === 'string' ? contract.ticker.toUpperCase() : null;
  if (!ticker) return null;
  const strike = Number(contract.strike_price ?? contract.strike);
  if (Number.isNaN(strike)) return null;
  const expiration =
    typeof contract?.expiration_date === 'string'
      ? contract.expiration_date
      : contract?.expiration;
  const type = contract?.contract_type === 'put' ? 'put' : 'call';
  const lastQuote = contract?.last_quote ?? {};
  const lastTrade = contract?.last_trade ?? {};
  const bid = resolveNumber(lastQuote?.bid ?? lastQuote?.bid_price);
  const ask = resolveNumber(lastQuote?.ask ?? lastQuote?.ask_price);
  const mid =
    lastQuote?.bid != null && lastQuote?.ask != null
      ? (lastQuote.bid + lastQuote.ask) / 2
      : resolveNumber(contract?.mid);
  const lastPrice =
    resolveNumber(lastTrade?.price) ??
    resolveNumber(contract?.last_price) ??
    mid;
  const volume = resolveNumber(contract?.day?.volume ?? contract?.volume);
  const openInterest = resolveNumber(contract?.open_interest);
  const iv = resolveNumber(contract?.implied_volatility);
  const breakeven =
    lastPrice != null
      ? type === 'call'
        ? strike + lastPrice
        : strike - lastPrice
      : null;
  return {
    ticker,
    type,
    strike,
    expiration,
    underlying: underlyingSymbol,
    bid,
    ask,
    mid,
    mark: resolveNumber(contract?.mark ?? contract?.mid ?? lastPrice),
    lastPrice,
    volume,
    openInterest,
    iv,
    greeks: contract?.greeks ?? {},
    delta: resolveNumber(contract?.greeks?.delta),
    gamma: resolveNumber(contract?.greeks?.gamma),
    theta: resolveNumber(contract?.greeks?.theta),
    vega: resolveNumber(contract?.greeks?.vega),
    rho: resolveNumber(contract?.greeks?.rho),
    breakeven,
    toBreakevenPercent: null,
    inTheMoney: undefined,
    change: null,
    changePercent: null,
    lastTrade: {
      price: resolveNumber(lastTrade?.price),
      size: resolveNumber(lastTrade?.size),
      sip_timestamp: lastTrade?.sip_timestamp ?? null
    }
  };
}

function normalizeOptionContractDetail(detail: any, fallbackTicker: string) {
  if (!detail) return null;
  const lastQuoteRaw = detail.last_quote ?? {};
  const lastTradeRaw = detail.last_trade ?? {};
  return {
    ticker: detail.ticker ?? fallbackTicker,
    underlying: detail.underlying_ticker,
    expiration: detail.expiration_date,
    type: detail.contract_type,
    strike: detail.strike_price,
    openInterest: detail.open_interest,
    breakEvenPrice: detail.break_even_price,
    impliedVolatility: detail.implied_volatility,
    day: detail.day,
    greeks: detail.greeks,
    lastQuote: {
      bid: lastQuoteRaw.bid ?? lastQuoteRaw.bid_price ?? null,
      ask: lastQuoteRaw.ask ?? lastQuoteRaw.ask_price ?? null,
      bidSize: lastQuoteRaw.bid_size ?? null,
      askSize: lastQuoteRaw.ask_size ?? null,
    },
    lastTrade: {
      price: lastTradeRaw.price ?? null,
      size: lastTradeRaw.size ?? null,
      sip_timestamp: lastTradeRaw.sip_timestamp ?? null,
    }
  };
}

export async function getMassiveOptionsSnapshot(underlying: string) {
  const symbol = underlying.toUpperCase();
  let payload: any;
  try {
    payload = await massiveGet(`/v3/snapshot/options/${symbol}`, {}, { cacheTtlMs: 5_000 });
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    console.warn('[MASSIVE] v3 snapshot missing for', symbol, '– falling back to v2');
    payload = await massiveGet(`/v2/snapshot/options/${symbol}`, {}, { cacheTtlMs: 5_000 });
  }
  console.log('[MASSIVE] snapshot payload', symbol, JSON.stringify(payload)?.slice(0, 500));
  const result = Array.isArray(payload?.results) ? payload.results[0] ?? {} : payload?.results ?? payload ?? {};
  const underlyingAsset = result?.underlying_asset ?? result?.underlying ?? {};
  const underlyingDay = underlyingAsset?.day ?? result?.day ?? {};
  const lastTrade = underlyingAsset?.last_trade ?? result?.last_trade ?? {};
  const lastQuote = underlyingAsset?.last_quote ?? result?.last_quote ?? {};
  const rawOptions = Array.isArray(result?.options)
    ? result.options
    : Array.isArray(result?.contracts)
    ? result.contracts
    : Array.isArray(payload?.results)
    ? payload.results
        .map((entry: any) => entry?.option ?? entry)
        .filter(Boolean)
    : [];

  let referenceOption: any = null;
  let bestVolume = -1;
  for (const option of rawOptions) {
    if (!option) continue;
    const candidate = option?.option ?? option;
    if (!candidate) continue;
    const volume =
      resolveNumber(candidate?.day?.volume) ??
      resolveNumber(candidate?.volume) ??
      resolveNumber(candidate?.details?.day?.volume) ??
      0;
    if (volume > bestVolume) {
      bestVolume = volume;
      referenceOption = candidate;
    }
  }

  const refQuote = referenceOption?.last_quote ?? referenceOption?.quote ?? {};
  const refDetails = referenceOption?.details ?? {};

  const price =
    resolveNumber(underlyingAsset?.price) ??
    resolveNumber(lastTrade?.price) ??
    computeMid(lastQuote?.bid, lastQuote?.ask) ??
    resolveNumber(underlyingDay?.close);
  const change = resolveNumber(underlyingDay?.change ?? underlyingAsset?.change);
  const changePercent = resolveNumber(underlyingDay?.change_percent ?? underlyingAsset?.change_percent);

  const snapshotResult = {
    ticker: typeof underlyingAsset?.ticker === 'string' ? underlyingAsset.ticker.toUpperCase() : symbol,
    name: underlyingAsset?.name ?? underlyingAsset?.description ?? symbol,
    price,
    change,
    changePercent,
    iv: resolveNumber(referenceOption?.implied_volatility),
    volume: resolveNumber(referenceOption?.day?.volume ?? referenceOption?.volume),
    openInterest: resolveNumber(referenceOption?.open_interest),
    referenceContract:
      typeof referenceOption?.ticker === 'string'
        ? referenceOption.ticker
        : typeof refDetails?.ticker === 'string'
        ? refDetails.ticker
        : undefined,
    referenceMid: computeMid(refQuote?.bid, refQuote?.ask),
  };
  console.log('[MASSIVE] options snapshot resolved', {
    ticker: snapshotResult.ticker,
    price: snapshotResult.price,
    referenceContract: snapshotResult.referenceContract
  });
  return snapshotResult;
}

export async function getMassiveOptionContractSnapshot(contractTicker: string) {
  const contractSymbol = contractTicker.toUpperCase();
  const contractDetail = await getMassiveOptionContract(contractSymbol);
  if (!contractDetail?.underlying) {
    throw new Error(`Contract ${contractSymbol} missing underlying`);
  }
  const underlyingSymbol = contractDetail.underlying.toUpperCase();
  let snapshot: any;
  try {
    snapshot = await massiveGet(
      `/v3/snapshot/options/${underlyingSymbol}/${contractSymbol}`,
      {},
      { cacheTtlMs: 3_000 }
    );
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    console.warn('[MASSIVE] v3 contract snapshot missing for', contractSymbol, '– falling back to v2');
    snapshot = await massiveGet(
      `/v2/snapshot/options/${underlyingSymbol}/${contractSymbol}`,
      {},
      { cacheTtlMs: 3_000 }
    );
  }
  console.log('[MASSIVE] contract snapshot payload', contractSymbol, JSON.stringify(snapshot)?.slice(0, 500));
  const payload = snapshot?.results ?? snapshot ?? {};
  const optionData = payload?.option ?? payload ?? {};
  const day = optionData?.day ?? contractDetail.day ?? {};
  const lastQuote = optionData?.last_quote ?? contractDetail.lastQuote ?? {};
  const lastTrade = optionData?.last_trade ?? contractDetail.lastTrade ?? {};
  const price =
    resolveNumber(lastTrade?.price) ??
    computeMid(lastQuote?.bid, lastQuote?.ask) ??
    resolveNumber(day?.close);

  const normalizedSnapshot = {
    contract: contractSymbol,
    ticker: contractSymbol,
    type: contractDetail.type,
    underlying: underlyingSymbol,
    name: contractDetail.ticker ?? contractSymbol,
    strike: contractDetail.strike ?? optionData?.strike_price ?? null,
    expiration: contractDetail.expiration ?? optionData?.expiration_date,
    price,
    bid: resolveNumber(lastQuote?.bid),
    ask: resolveNumber(lastQuote?.ask),
    mid: computeMid(lastQuote?.bid, lastQuote?.ask),
    change: resolveNumber(day?.change ?? day?.change_percent),
    changePercent: resolveNumber(day?.change_percent),
    iv: resolveNumber(optionData?.implied_volatility ?? contractDetail.impliedVolatility),
    volume: resolveNumber(day?.volume ?? optionData?.volume),
    openInterest: resolveNumber(optionData?.open_interest ?? contractDetail.openInterest),
  };
  console.log('[MASSIVE] contract snapshot resolved', {
    contract: normalizedSnapshot.contract,
    underlying: normalizedSnapshot.underlying,
    price: normalizedSnapshot.price
  });
  return normalizedSnapshot;
}

type IndicatorType = 'sma' | 'ema' | 'rsi' | 'macd';

function normalizeIndicatorValues(indicator: IndicatorType, entries: any[]): { timestamp: number; value: number | null; meta?: any }[] {
  return entries.map(entry => {
    const timestamp = entry.timestamp ?? entry.t ?? (entry.time ? Date.parse(entry.time) : Date.now());
    const fallbackValue =
      entry.value ??
      entry[indicator] ??
      entry.signal ??
      entry.histogram ??
      entry.macd ??
      entry.ema ??
      entry.rsi ??
      null;
    const value = typeof fallbackValue === 'number' ? fallbackValue : null;
    return {
      timestamp,
      value,
      meta: entry
    };
  });
}

function computeTrendFromValues(values: { value: number | null }[]) {
  const latest = values[0]?.value ?? null;
  const previous = values[1]?.value ?? null;
  let trend: 'rising' | 'falling' | 'flat' | undefined;
  if (typeof latest === 'number' && typeof previous === 'number') {
    if (latest > previous) trend = 'rising';
    else if (latest < previous) trend = 'falling';
    else trend = 'flat';
  }
  return { latest, previous, trend };
}

async function fetchIndicatorSeries(
  indicator: IndicatorType,
  symbol: string,
  params: Record<string, any>
) {
  const payload = await massiveGet(`/v1/indicators/${indicator}/${symbol}`, params, { cacheTtlMs: 30_000 });
  const rawValues = payload?.results?.values ?? payload?.values ?? [];
  const normalized = normalizeIndicatorValues(indicator, rawValues);
  const { latest, previous, trend } = computeTrendFromValues(normalized);
  console.log('[MASSIVE] indicator resolved', {
    indicator: indicator.toUpperCase(),
    ticker: symbol,
    latest,
    previous,
    points: normalized.length
  });
  return {
    latest,
    trend,
    values: normalized
  };
}

export async function getMassiveIndicators(optionSymbol: string, window = 50) {
  const symbol = optionSymbol.toUpperCase();
  const baseParams = {
    timespan: 'day',
    adjusted: true,
    limit: 500,
    order: 'desc'
  };

  async function safeFetch(indicator: IndicatorType, extra: Record<string, any> = {}) {
    try {
      return await fetchIndicatorSeries(indicator, symbol, { ...baseParams, ...extra });
    } catch (error) {
      console.error(`[MASSIVE] indicator ${indicator.toUpperCase()} failed for ${symbol}`, error);
      return undefined;
    }
  }

  const [sma, ema, rsi, macd] = await Promise.all([
    safeFetch('sma', { window, series_type: 'close' }),
    safeFetch('ema', { window, series_type: 'close' }),
    safeFetch('rsi', { window: 14, series_type: 'close' }),
    safeFetch('macd', { short_window: 12, long_window: 26, signal_window: 9, series_type: 'close' })
  ]);

  return {
    ticker: symbol,
    sma,
    ema,
    rsi,
    macd
  };
}
