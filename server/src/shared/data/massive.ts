import axios from 'axios';
import { createHash } from 'node:crypto';
import {
  MassiveEntitlementError,
  isEntitlementFailure,
  isRetryableMassiveError,
  resolveMassiveRetryDelayMs,
} from './massiveRetry';
import { computeDteEt } from '../time/tradingCalendar';
// Handles authenticated + rate-limited access to Massive.com's API, with caching + retry logic.
// Retry policy is centralized in ./massiveRetry so it stays consistent with massiveProvider.ts.

// ---------------------------------------------------------------------------
// Request priorities. Lower number = drained first. Risk exits and automation
// decisions must never starve behind watchlist/background refreshes.
// ---------------------------------------------------------------------------
export const REQUEST_PRIORITY = {
  CRITICAL_EXIT: 0,
  OPEN_POSITION: 1,
  AUTOMATION_DECISION: 2,
  ACTIVE_CONTRACT: 3,
  VISIBLE_UI: 4,
  SCANNER: 5,
  WATCHLIST: 6,
  BACKGROUND: 7,
} as const;

export type RequestPriority = (typeof REQUEST_PRIORITY)[keyof typeof REQUEST_PRIORITY];

const DEFAULT_PRIORITY: RequestPriority = REQUEST_PRIORITY.VISIBLE_UI;

/** Short stable hash for correlating cursors/keys in logs without leaking them. */
export function logHash(value: string | null | undefined): string | null {
  if (!value) return null;
  return createHash('sha256').update(value).digest('hex').slice(0, 8);
}

// ---------------------------------------------------------------------------
// Entitlement registry. Once Massive tells us an endpoint class is outside the
// plan (HTTP 403 / NOT_AUTHORIZED body), we stop calling it for a long window
// instead of burning rate-limit budget on requests that can never succeed.
// ---------------------------------------------------------------------------
const ENTITLEMENT_BLOCK_TTL_MS = Math.max(
  60_000,
  Number(process.env.MASSIVE_ENTITLEMENT_BLOCK_TTL_MS ?? 6 * 60 * 60 * 1000)
);

type EntitlementBlock = { until: number; message: string; httpStatus: number | null };
const entitlementBlocks = new Map<string, EntitlementBlock>();

// Provider 429s are usually endpoint-class limits, not single-request limits.
// Keep a short block after final/observed 429s so the next UI/AI/chart caller
// falls through to cache/fallback paths instead of immediately hitting Massive.
const RATE_LIMIT_BLOCK_TTL_MS = Math.max(
  1_000,
  Number(process.env.MASSIVE_RATE_LIMIT_BLOCK_TTL_MS ?? 60_000)
);

type RateLimitBlock = { until: number; message: string; retryAfterMs: number | null };
const rateLimitBlocks = new Map<string, RateLimitBlock>();

const MASSIVE_LOG_THROTTLE_MS = Math.max(
  0,
  Number(process.env.MASSIVE_LOG_THROTTLE_MS ?? 30_000)
);
const massiveLogLastAt = new Map<string, number>();

/** Endpoint class used for entitlement tracking: template-ish path prefix. */
function endpointClassOf(path: string): string {
  // /v2/aggs/ticker/SPY/range/5/minute/... → /v2/aggs/:ticker/range/:mult/:timespan
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'v2' && parts[1] === 'aggs' && parts[2] === 'ticker') {
    const isOption = (parts[3] ?? '').startsWith('O:');
    const timespan = parts[6] ?? parts[4] ?? '';
    return `/v2/aggs/${isOption ? 'options' : 'stocks'}/${timespan}`;
  }
  return `/${parts.slice(0, 3).join('/')}`;
}

export function getEntitlementBlocks(): Record<string, { until: string; message: string }> {
  const now = Date.now();
  const out: Record<string, { until: string; message: string }> = {};
  for (const [key, block] of entitlementBlocks) {
    if (block.until > now) out[key] = { until: new Date(block.until).toISOString(), message: block.message };
  }
  return out;
}

export function clearEntitlementBlocks() {
  entitlementBlocks.clear();
}

export function getRateLimitBlocks(): Record<string, { until: string; message: string; retryAfterMs: number | null }> {
  const now = Date.now();
  const out: Record<string, { until: string; message: string; retryAfterMs: number | null }> = {};
  for (const [key, block] of rateLimitBlocks) {
    if (block.until > now) {
      out[key] = {
        until: new Date(block.until).toISOString(),
        message: block.message,
        retryAfterMs: block.retryAfterMs,
      };
    }
  }
  return out;
}

export function clearRateLimitBlocks() {
  rateLimitBlocks.clear();
}

const MASSIVE_API_KEY = process.env.MASSIVE_API_KEY;
const MASSIVE_BASE_URL = process.env.MASSIVE_BASE_URL || 'https://api.massive.com';
const MASSIVE_DEFAULT_CACHE_TTL_MS = Number(process.env.MASSIVE_CACHE_TTL_MS ?? 10_000);
const MASSIVE_INTRADAY_AGGS_CACHE_TTL_MS = Math.max(
  0,
  Number(process.env.MASSIVE_INTRADAY_AGGS_CACHE_TTL_MS ?? 15_000)
);
const MASSIVE_DAILY_AGGS_CACHE_TTL_MS = Math.max(
  60_000,
  Number(process.env.MASSIVE_DAILY_AGGS_CACHE_TTL_MS ?? 15 * 60 * 1000)
);
const MASSIVE_TIMEOUT_MS = Math.max(1_000, Number(process.env.MASSIVE_TIMEOUT_MS ?? 10_000));
const MASSIVE_MAX_CONCURRENT = Math.max(1, Number(process.env.MASSIVE_MAX_CONCURRENT ?? 1));
const MASSIVE_MIN_INTERVAL_MS = Math.max(0, Number(process.env.MASSIVE_MIN_INTERVAL_MS ?? 1_000));
const MASSIVE_MAX_RETRIES = Math.max(0, Number(process.env.MASSIVE_MAX_RETRIES ?? 3));
const MASSIVE_RETRY_BASE_MS = Math.max(100, Number(process.env.MASSIVE_RETRY_BASE_MS ?? 500));
const MASSIVE_RETRY_MAX_MS = Math.max(MASSIVE_RETRY_BASE_MS, Number(process.env.MASSIVE_RETRY_MAX_MS ?? 5_000));
const MASSIVE_REFERENCE_MAX_PAGES = Math.min(Math.max(Number(process.env.MASSIVE_REFERENCE_MAX_PAGES ?? 10), 1), 50);
const MASSIVE_SNAPSHOT_MAX_PAGES = Math.min(Math.max(Number(process.env.MASSIVE_SNAPSHOT_MAX_PAGES ?? 25), 1), 50);
const MASSIVE_SNAPSHOT_PAGE_LIMIT = Math.min(Math.max(Number(process.env.MASSIVE_SNAPSHOT_PAGE_LIMIT ?? 150), 1), 150);
export const MASSIVE_MAX_CHAIN_LIMIT = Math.min(Math.max(Number(process.env.MASSIVE_MAX_CHAIN_LIMIT ?? 1000), 1), 1000);
const AGG_TIMESTAMP_MS_THRESHOLD = 1_000_000_000_000;

const client = axios.create({
  baseURL: MASSIVE_BASE_URL,
  timeout: MASSIVE_TIMEOUT_MS
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
  /** Drain order in the shared request queue; defaults to VISIBLE_UI. */
  priority?: RequestPriority;
};

type QueueTask<T> = {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
  priority: RequestPriority;
  seq: number;
};

type CacheEntry = {
  value: any;
  expiresAt: number;
  cachedAt: number;
};

const responseCache = new Map<string, CacheEntry>();
const inflightRequests = new Map<string, Promise<any>>();
const requestQueue: QueueTask<any>[] = [];
let queueSeq = 0;
let activeRequests = 0;
let nextAvailableTimestamp = Date.now();
let scheduledDrain: NodeJS.Timeout | null = null;
let providerCooldownUntil = 0;

type MassiveRequestMetrics = {
  cacheHits: number;
  cacheMisses: number;
  deduplicatedRequests: number;
  rateLimitResponses: number;
  backgroundDropped: number;
  requestsByPriority: Record<string, number>;
};

const requestMetrics: MassiveRequestMetrics = {
  cacheHits: 0,
  cacheMisses: 0,
  deduplicatedRequests: 0,
  rateLimitResponses: 0,
  backgroundDropped: 0,
  requestsByPriority: {},
};

const PRIORITY_NAME_BY_VALUE = new Map<number, string>(
  Object.entries(REQUEST_PRIORITY).map(([name, value]) => [value, name])
);

function priorityName(priority: RequestPriority): string {
  return PRIORITY_NAME_BY_VALUE.get(priority) ?? String(priority);
}

function isBackgroundPriority(priority: RequestPriority): boolean {
  return priority >= REQUEST_PRIORITY.WATCHLIST;
}

function recordPriorityRequest(priority: RequestPriority): void {
  const name = priorityName(priority);
  requestMetrics.requestsByPriority[name] = (requestMetrics.requestsByPriority[name] ?? 0) + 1;
}

function setProviderCooldown(delayMs: number): void {
  if (!Number.isFinite(delayMs) || delayMs <= 0) return;
  providerCooldownUntil = Math.max(providerCooldownUntil, Date.now() + delayMs);
}

function logMassiveEvent(
  level: 'log' | 'warn' | 'error',
  event: string,
  payload: Record<string, any> = {},
  throttleKey?: string
): void {
  const now = Date.now();
  if (throttleKey && MASSIVE_LOG_THROTTLE_MS > 0) {
    const key = `${event}:${throttleKey}`;
    const lastAt = massiveLogLastAt.get(key) ?? 0;
    if (now - lastAt < MASSIVE_LOG_THROTTLE_MS) return;
    massiveLogLastAt.set(key, now);
  }

  const entry = {
    timestamp: new Date(now).toISOString(),
    service: 'massive-client',
    event,
    ...payload,
  };
  const line = JSON.stringify(entry);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function registerRateLimitBlock(path: string, message: string, retryAfterMs: number | null): void {
  const endpointClass = endpointClassOf(path);
  const ttlMs = Math.max(RATE_LIMIT_BLOCK_TTL_MS, retryAfterMs ?? 0);
  const until = Date.now() + ttlMs;
  const current = rateLimitBlocks.get(endpointClass);
  if (current && current.until >= until) return;
  rateLimitBlocks.set(endpointClass, { until, message, retryAfterMs });
  logMassiveEvent(
    'warn',
    'RATE_LIMIT_BLOCK_REGISTERED',
    {
      endpointClass,
      retryAfterMs,
      blockTtlMs: ttlMs,
      until: new Date(until).toISOString(),
      message,
    },
    endpointClass
  );
}

function activeRateLimitBlock(endpointClass: string, now: number): RateLimitBlock | null {
  const block = rateLimitBlocks.get(endpointClass);
  if (!block) return null;
  if (block.until > now) return block;
  rateLimitBlocks.delete(endpointClass);
  return null;
}

function clearRateLimitBlockForPath(path: string): void {
  const endpointClass = endpointClassOf(path);
  if (!rateLimitBlocks.delete(endpointClass)) return;
  logMassiveEvent('log', 'RATE_LIMIT_BLOCK_CLEARED', { endpointClass }, endpointClass);
}

/**
 * Sprint 2F — read-only observability into the SINGLE shared Massive request
 * manager (queue + inflight dedup + response cache). Used by /api/system/health.
 */
export function getMassiveRequestStats() {
  const totalCacheReads = requestMetrics.cacheHits + requestMetrics.cacheMisses;
  const now = Date.now();
  const cooldownUntil =
    providerCooldownUntil > now ? new Date(providerCooldownUntil).toISOString() : null;
  const activeRateLimitBlocks = getRateLimitBlocks();
  return {
    state: cooldownUntil || Object.keys(activeRateLimitBlocks).length ? 'COOLDOWN' : 'OK',
    cooldownUntil,
    rateLimitBlocks: activeRateLimitBlocks,
    queueDepth: requestQueue.length,
    activeRequests,
    inflightDeduped: inflightRequests.size,
    responseCacheEntries: responseCache.size,
    cacheHits: requestMetrics.cacheHits,
    cacheMisses: requestMetrics.cacheMisses,
    cacheHitRate: totalCacheReads > 0 ? requestMetrics.cacheHits / totalCacheReads : null,
    deduplicatedRequests: requestMetrics.deduplicatedRequests,
    rateLimitResponses: requestMetrics.rateLimitResponses,
    backgroundDropped: requestMetrics.backgroundDropped,
    requestsByPriority: { ...requestMetrics.requestsByPriority },
    pendingRequestsByPriority: getPendingRequestsByPriority(),
  };
}

/** Pending request counts by priority (for the market-data health endpoint). */
export function getPendingRequestsByPriority(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const task of requestQueue) {
    const name = priorityName(task.priority);
    counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
}

function normalizeAggTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < AGG_TIMESTAMP_MS_THRESHOLD ? value * 1000 : value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric < AGG_TIMESTAMP_MS_THRESHOLD ? numeric * 1000 : numeric;
    }
  }
  return null;
}

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

export function clampChainLimit(requestedLimit: number): number {
  if (!Number.isFinite(requestedLimit)) {
    return MASSIVE_MAX_CHAIN_LIMIT;
  }
  return Math.min(Math.max(Math.floor(requestedLimit), 1), MASSIVE_MAX_CHAIN_LIMIT);
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

  // Priority drain: lowest priority value first, FIFO (seq) within a class.
  let bestIndex = 0;
  for (let i = 1; i < requestQueue.length; i += 1) {
    const candidate = requestQueue[i];
    const best = requestQueue[bestIndex];
    if (candidate.priority < best.priority || (candidate.priority === best.priority && candidate.seq < best.seq)) {
      bestIndex = i;
    }
  }
  const task = requestQueue.splice(bestIndex, 1)[0];
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

function scheduleRequest<T>(run: () => Promise<T>, priority: RequestPriority): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queueSeq += 1;
    requestQueue.push({ run, resolve, reject, priority, seq: queueSeq });
    drainQueue();
  });
}

/**
 * Generic Massive GET helper. Handles parameter normalization, request
 * deduping, caching, and automatic retries with exponential backoff. Most
 * feature modules call this instead of touching axios directly.
 */
export async function massiveGet<T = any>(
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
  const priority = options?.priority ?? DEFAULT_PRIORITY;

  const cachedEntry = responseCache.get(cacheKey);
  const now = Date.now();
  if (ttl > 0 && cachedEntry && cachedEntry.expiresAt > now) {
    requestMetrics.cacheHits += 1;
    logMassiveEvent(
      'log',
      'CACHE_HIT',
      {
        path,
        endpointClass: endpointClassOf(path),
        priority: priorityName(priority),
        ageMs: now - cachedEntry.cachedAt,
        ttlMs: ttl,
      },
      cacheKey
    );
    return cachedEntry.value;
  }
  requestMetrics.cacheMisses += 1;

  // Entitlement-blocked endpoint classes fail fast without consuming queue or
  // provider capacity — a plan limitation is not a transient error.
  const endpointClass = endpointClassOf(path);
  logMassiveEvent(
    'log',
    'CACHE_MISS',
    { path, endpointClass, priority: priorityName(priority), ttlMs: ttl },
    cacheKey
  );
  const block = entitlementBlocks.get(endpointClass);
  if (block) {
    if (block.until > now) {
      throw new MassiveEntitlementError(path, block.httpStatus, block.message);
    }
    entitlementBlocks.delete(endpointClass);
  }

  const rateLimitBlock = activeRateLimitBlock(endpointClass, now);
  if (rateLimitBlock) {
    if (cachedEntry) {
      requestMetrics.cacheHits += 1;
      logMassiveEvent(
        'warn',
        'STALE_CACHE_RETURNED_DURING_RATE_LIMIT',
        {
          path,
          endpointClass,
          priority: priorityName(priority),
          cooldownUntil: new Date(rateLimitBlock.until).toISOString(),
          ageMs: now - cachedEntry.cachedAt,
        },
        cacheKey
      );
      return cachedEntry.value;
    }
    logMassiveEvent(
      'warn',
      'RATE_LIMIT_BLOCKED_REQUEST',
      {
        path,
        endpointClass,
        priority: priorityName(priority),
        cooldownUntil: new Date(rateLimitBlock.until).toISOString(),
        message: rateLimitBlock.message,
      },
      cacheKey
    );
    const error: any = new Error('Massive rate limit cooldown active');
    error.status = 429;
    error.code = 'MASSIVE_RATE_LIMIT_COOLDOWN';
    error.cooldownUntil = new Date(rateLimitBlock.until).toISOString();
    error.response = { status: 429, headers: {} };
    throw error;
  }

  if (providerCooldownUntil > now && isBackgroundPriority(priority)) {
    if (cachedEntry) {
      requestMetrics.cacheHits += 1;
      logMassiveEvent(
        'warn',
        'STALE_CACHE_RETURNED_DURING_PROVIDER_COOLDOWN',
        {
          path,
          endpointClass,
          priority: priorityName(priority),
          cooldownUntil: new Date(providerCooldownUntil).toISOString(),
          ageMs: now - cachedEntry.cachedAt,
        },
        cacheKey
      );
      return cachedEntry.value;
    }
    requestMetrics.backgroundDropped += 1;
    const error: any = new Error('Massive provider cooldown active');
    error.status = 429;
    error.code = 'MASSIVE_PROVIDER_COOLDOWN';
    error.cooldownUntil = new Date(providerCooldownUntil).toISOString();
    throw error;
  }

  if (inflightRequests.has(cacheKey)) {
    requestMetrics.deduplicatedRequests += 1;
    logMassiveEvent(
      'log',
      'INFLIGHT_DEDUPED',
      { path, endpointClass, priority: priorityName(priority) },
      cacheKey
    );
    return inflightRequests.get(cacheKey)! as Promise<T>;
  }

  recordPriorityRequest(priority);
  const requestPromise = scheduleRequest(() => executeMassiveRequest<T>(path, normalizedParams), priority);

  inflightRequests.set(cacheKey, requestPromise);

  try {
    const payload = await requestPromise;
    if (ttl > 0) {
      responseCache.set(cacheKey, { value: payload, expiresAt: Date.now() + ttl, cachedAt: Date.now() });
    }
    return payload;
  } catch (error) {
    if (cachedEntry) {
      requestMetrics.cacheHits += 1;
      logMassiveEvent(
        'warn',
        'STALE_CACHE_RETURNED_AFTER_FAILURE',
        {
          path,
          endpointClass,
          ageMs: Date.now() - cachedEntry.cachedAt,
          reason: axios.isAxiosError(error) ? error.response?.status : (error as any)?.status ?? 'error',
        },
        cacheKey
      );
      return cachedEntry.value;
    }
    throw error;
  } finally {
    inflightRequests.delete(cacheKey);
  }
}

/** Log-safe copy of request params: cursors are replaced with a short hash. */
function sanitizeParamsForLog(params: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(params)) {
    if (key.toLowerCase() === 'cursor' && typeof value === 'string') {
      out[key] = `#${logHash(value)}`;
    } else if (key.toLowerCase() === 'apikey') {
      continue;
    } else {
      out[key] = value;
    }
  }
  return out;
}

function registerEntitlementBlock(path: string, httpStatus: number | null, message: string) {
  const endpointClass = endpointClassOf(path);
  entitlementBlocks.set(endpointClass, {
    until: Date.now() + ENTITLEMENT_BLOCK_TTL_MS,
    message,
    httpStatus,
  });
  logMassiveEvent(
    'warn',
    'ENTITLEMENT_BLOCK_REGISTERED',
    {
      endpointClass,
      httpStatus,
      blockTtlMs: ENTITLEMENT_BLOCK_TTL_MS,
      message,
    },
    endpointClass
  );
}

async function executeMassiveRequest<T>(
  path: string,
  normalizedParams: Record<string, any>,
  attempt: number = 0
): Promise<T> {
  try {
    logMassiveEvent(
      'log',
      'REQUEST_STARTED',
      {
        path,
        endpointClass: endpointClassOf(path),
        params: sanitizeParamsForLog(normalizedParams),
        attempt: attempt + 1,
      },
      `${path}:${attempt}`
    );
    const { data } = await client.get<MassiveResponse<T>>(path, {
      params: {
        apiKey: MASSIVE_API_KEY,
        ...normalizedParams
      },
      headers: {
        Authorization: `Bearer ${MASSIVE_API_KEY}`,
        'X-API-Key': MASSIVE_API_KEY
      }
    });
    // Massive can report plan limits inside a 2xx body.
    if (isEntitlementFailure(null, data)) {
      const message = typeof (data as any)?.message === 'string' ? (data as any).message : 'NOT_AUTHORIZED';
      registerEntitlementBlock(path, null, message);
      throw new MassiveEntitlementError(path, null, message);
    }
    clearRateLimitBlockForPath(path);
    return (data as any) ?? {};
  } catch (error) {
    if (error instanceof MassiveEntitlementError) throw error;
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    if (isEntitlementFailure(status ?? null, axios.isAxiosError(error) ? error.response?.data : null)) {
      const body = axios.isAxiosError(error) ? (error.response?.data as any) : null;
      const message = typeof body?.message === 'string' ? body.message : 'plan does not include this data';
      registerEntitlementBlock(path, status ?? null, message);
      throw new MassiveEntitlementError(path, status ?? null, message);
    }
    if (isRetryableMassiveError(error, attempt, MASSIVE_MAX_RETRIES)) {
      const delayMs = resolveMassiveRetryDelayMs(error, attempt, {
        baseMs: MASSIVE_RETRY_BASE_MS,
        maxMs: MASSIVE_RETRY_MAX_MS
      });
      if (status === 429) {
        requestMetrics.rateLimitResponses += 1;
        setProviderCooldown(delayMs);
        registerRateLimitBlock(path, 'Massive returned HTTP 429; backing off endpoint class.', delayMs);
      }
      logMassiveEvent(
        'warn',
        'REQUEST_RETRY_SCHEDULED',
        {
          path,
          endpointClass: endpointClassOf(path),
          status,
          attempt: attempt + 1,
          retryDelayMs: delayMs,
        },
        `${path}:${status}:${attempt}`
      );
      await delay(delayMs);
      return executeMassiveRequest(path, normalizedParams, attempt + 1);
    }
    if (status === 429) {
      requestMetrics.rateLimitResponses += 1;
      setProviderCooldown(MASSIVE_RETRY_MAX_MS);
      registerRateLimitBlock(path, 'Massive returned HTTP 429 after retry budget was exhausted.', null);
    }
    throw error;
  }
}

function isNotFoundError(error: unknown) {
  return axios.isAxiosError(error) && error.response?.status === 404;
}

/**
 * Convenience wrapper for `/v2/aggs/ticker/...` tailored for option symbols.
 * Automatically backfills missing date ranges by computing a default `from`
 * window when callers omit dates.
 */
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
  const isIntraday = timespan === 'minute' || timespan === 'hour';
  const cacheTtlMs = isIntraday ? MASSIVE_INTRADAY_AGGS_CACHE_TTL_MS : MASSIVE_DAILY_AGGS_CACHE_TTL_MS;
  const sortOrder = isIntraday ? 'desc' : 'asc';
  const payload = await massiveGet(
    endpoint,
    { adjusted: true, sort: sortOrder, limit: window },
    { cacheTtlMs }
  );

  type AggregateResultBar = {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    vwap: number | null;
    transactions: number | null;
  };

  const results: AggregateResultBar[] = [];
  if (Array.isArray(payload?.results)) {
    for (const row of payload.results) {
      const timestamp = normalizeAggTimestamp(row?.t ?? row?.timestamp);
      if (timestamp == null) continue;
      results.push({
        timestamp,
        open: row.o ?? row.open,
        high: row.h ?? row.high,
        low: row.l ?? row.low,
        close: row.c ?? row.close,
        volume: row.v ?? row.volume ?? 0,
        vwap: row.vw ?? row.vwap ?? null,
        transactions: row.n ?? row.transactions ?? null
      });
    }
  }

  console.log('[MASSIVE] aggregates resolved', {
    ticker: symbol,
    endpoint,
    count: results.length,
    from: from.toISOString(),
    to: to.toISOString()
  });

  return { ticker: symbol, results };
}

/**
 * Fetches raw option trades from Massive. No caching because trades are highly
 * time-sensitive.
 */
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
      timestamp: normalizeProviderTimestamp(trade.sip_timestamp ?? trade.timestamp),
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

/**
 * Retrieves the latest option quotes. Returns both the active quote and the
 * recent history so UIs can render depth.
 */
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
      timestamp: normalizeProviderTimestamp(quote.sip_timestamp ?? quote.timestamp),
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

/**
 * Fetches metadata for a specific option contract (strike, expiration,
 * greeks). Used when hydrating selections or chains.
 */
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

function applyReferenceUnderlyingFilter(params: Record<string, any>, underlying: string) {
  // Massive's reference contracts endpoint uses `underlying_ticker`.
  // Sending the snapshot endpoint's `underlying_asset` filter here can produce
  // a 200 response with an empty result set on some provider paths.
  params.underlying_ticker = underlying.toUpperCase();
}

function logOptionReferenceEmpty(event: string, payload: Record<string, any>) {
  console.warn(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      service: 'massive-options-reference',
      event,
      ...payload,
    })
  );
}

/**
 * Lists option contracts with filtering/pagination. Primarily consumed when
 * building option chains server-side.
 */
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
    applyReferenceUnderlyingFilter(params, normalized);
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
  if (contracts.length === 0) {
    logOptionReferenceEmpty('REFERENCE_CONTRACTS_EMPTY', {
      underlying: params.underlying_ticker ?? null,
      ticker: params.ticker ?? null,
      contractType: params.contract_type ?? null,
      expiration: params.expiration_date ?? null,
      limit,
      hasNext: Boolean(payload.next_url),
      requestId: payload.request_id ?? null,
    });
  }
  return {
    results,
    nextUrl: payload.next_url ?? null,
    requestId: payload.request_id
  };
}

/**
 * Returns the set of expirations available for an underlying by scanning the
 * reference contracts endpoint.
 */
export async function listOptionExpirations(
  underlying: string,
  opts: { limit?: number; maxPages?: number } = {}
) {
  const symbol = underlying.toUpperCase();
  const limitParam = Number(opts.limit ?? 1000) || 1000;
  const limit = Math.min(Math.max(limitParam, 1), 1000);
  const maxPagesParam = Number(opts.maxPages ?? 5) || 5;
  const maxPages = Math.min(Math.max(maxPagesParam, 1), 25);
  const expirations = new Set<string>();
  let cursor: string | null = null;
  let pagesFetched = 0;

  do {
    const params: Record<string, any> = {
      limit,
      order: 'asc',
      sort: 'expiration_date'
    };
    applyReferenceUnderlyingFilter(params, symbol);
    if (cursor) {
      params.cursor = cursor;
    }
    const payload = await massiveGet('/v3/reference/options/contracts', params, { cacheTtlMs: 60_000 });
    const results = Array.isArray(payload?.results) ? payload.results : [];
    if (results.length === 0) {
      logOptionReferenceEmpty('EXPIRATIONS_REFERENCE_PAGE_EMPTY', {
        underlying: symbol,
        page: pagesFetched + 1,
        limit,
        cursor: logHash(cursor),
        hasNext: Boolean(payload?.next_url),
        requestId: payload?.request_id ?? null,
      });
    }
    for (const contract of results) {
      const rawExpiration =
        typeof contract?.expiration_date === 'string'
          ? contract.expiration_date
          : typeof contract?.expiration === 'string'
            ? contract.expiration
            : null;
      const expiration = normalizeExpirationDate(rawExpiration);
      if (expiration) {
        expirations.add(expiration);
      }
    }
    cursor = extractCursor(payload?.next_url);
    pagesFetched += 1;
  } while (cursor && pagesFetched < maxPages);

  if (expirations.size === 0) {
    logOptionReferenceEmpty('EXPIRATIONS_EMPTY', {
      underlying: symbol,
      pagesFetched,
      limit,
      maxPages,
    });
  }

  return {
    ticker: symbol,
    expirations: Array.from(expirations).sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
  };
}

/**
 * Lists known option exchanges. Handy for populating dropdowns or debugging
 * quotes.
 */
export async function listOptionExchanges(params: { asset_class?: string; locale?: string } = {}) {
  const payload = await massiveGet('/v3/reference/exchanges', {
    asset_class: params.asset_class ?? 'options',
    locale: params.locale ?? 'us'
  });
  return Array.isArray(payload?.results) ? payload.results : payload?.exchanges ?? [];
}

/**
 * Lists trade/quote condition codes so the UI can label unusual prints.
 */
export async function listOptionConditions(params: { asset_class?: string; limit?: number; order?: string; sort?: string } = {}) {
  const payload = await massiveGet('/v3/reference/conditions', {
    asset_class: params.asset_class ?? 'options',
    limit: params.limit ?? 50,
    order: params.order ?? 'asc',
    sort: params.sort ?? 'asset_class'
  });
  return Array.isArray(payload?.results) ? payload.results : payload?.conditions ?? [];
}

export async function fetchReferenceContracts(
  params: Record<string, any>,
  options: { maxPages?: number; cacheTtlMs?: number; priority?: RequestPriority } = {}
) {
  const maxPages = Math.min(Math.max(options.maxPages ?? 1, 1), MASSIVE_REFERENCE_MAX_PAGES);
  const aggregated: any[] = [];
  let cursor: string | null = null;
  let pagesFetched = 0;
  let nextCursor: string | null = null;
  const baseLimit = clampChainLimit(Number(params.limit ?? MASSIVE_MAX_CHAIN_LIMIT));

  do {
    const pageParams: Record<string, any> = {
      ...params,
      limit: baseLimit
    };
    if (cursor) {
      pageParams.cursor = cursor;
    }
    const payload = await massiveGet('/v3/reference/options/contracts', pageParams, {
      cacheTtlMs: options.cacheTtlMs ?? 60_000,
      priority: options.priority,
    });
    const pageResults = Array.isArray(payload?.results) ? payload.results : [];
    aggregated.push(...pageResults);
    nextCursor = extractCursor(payload?.next_url);
    cursor = nextCursor;
    pagesFetched += 1;
  } while (cursor && pagesFetched < maxPages);

  return {
    results: aggregated,
    pagesFetched,
    exhausted: !cursor,
    nextCursor,
  };
}

export async function fetchSnapshotOptions(
  symbol: string,
  params: Record<string, any>,
  options: { maxPages?: number; cacheTtlMs?: number; priority?: RequestPriority } = {}
) {
  const maxPages = Math.min(Math.max(options.maxPages ?? MASSIVE_SNAPSHOT_MAX_PAGES, 1), MASSIVE_SNAPSHOT_MAX_PAGES);
  const aggregated: any[] = [];
  let pagesFetched = 0;
  let exhausted = true;
  let resolvedRoot: any = null;
  let underlyingAsset: any = null;

  let nextRequest: { path: string; params: Record<string, any> } | null = {
    path: `/v3/snapshot/options/${symbol}`,
    params: { ...params }
  };

  while (nextRequest && pagesFetched < maxPages) {
    const payload = await massiveGet(nextRequest.path, nextRequest.params, {
      cacheTtlMs: options.cacheTtlMs ?? 5_000,
      priority: options.priority,
    });
    console.log('[MASSIVE] snapshot page', {
      symbol,
      page: pagesFetched + 1,
      results: Array.isArray(payload?.results) ? payload.results.length : null,
      nextCursor: logHash(extractCursor(payload?.next_url)),
    });
    if (!resolvedRoot) {
      resolvedRoot = resolveSnapshotRoot(payload);
    }
    if (!underlyingAsset) {
      underlyingAsset = extractSnapshotUnderlying(payload);
    }
    const optionsChunk = extractSnapshotOptions(payload);
    aggregated.push(...optionsChunk);
    pagesFetched += 1;
    nextRequest = parseMassiveNextUrl(payload?.next_url);
  }

  let nextCursor: string | null = null;
  if (nextRequest) {
    exhausted = false;
    nextCursor = typeof nextRequest.params?.cursor === 'string' ? nextRequest.params.cursor : null;
  }

  return {
    options: aggregated,
    root: resolvedRoot,
    underlyingAsset,
    pagesFetched,
    exhausted,
    nextCursor,
  };
}

/**
 * The v3 chain snapshot returns a flat `results[]` of contracts, each carrying
 * an `underlying_asset` block ({ price, last_updated, timeframe, ticker }).
 * Older/alternate shapes put it on the root. Handle both.
 */
export function extractSnapshotUnderlying(payload: any): any {
  const root = payload?.results;
  if (Array.isArray(root)) {
    for (const entry of root) {
      const candidate = entry?.underlying_asset ?? entry?.option?.underlying_asset;
      if (candidate && typeof candidate === 'object') return candidate;
    }
    return null;
  }
  return payload?.underlying_asset ?? root?.underlying_asset ?? null;
}

function resolveSnapshotRoot(payload: any) {
  const snapshotResults = Array.isArray(payload?.results) ? payload.results : null;
  if (
    snapshotResults &&
    snapshotResults.length &&
    (Array.isArray(snapshotResults[0]?.options) || Array.isArray(snapshotResults[0]?.contracts))
  ) {
    return snapshotResults[0];
  }
  if (Array.isArray(payload?.results)) {
    return payload.results ?? {};
  }
  if (Array.isArray(payload)) {
    return payload ?? {};
  }
  return payload ?? {};
}

function extractSnapshotOptions(payload: any) {
  const snapshotResults = Array.isArray(payload?.results) ? payload.results : null;
  if (snapshotResults && snapshotResults.length) {
    if (Array.isArray(snapshotResults[0]?.options)) {
      return snapshotResults[0].options ?? [];
    }
    if (Array.isArray(snapshotResults[0]?.contracts)) {
      return snapshotResults[0].contracts ?? [];
    }
    return snapshotResults
      .map((entry: any) => entry?.option ?? entry)
      .filter(Boolean);
  }
  if (Array.isArray(payload?.options)) return payload.options;
  if (Array.isArray(payload?.contracts)) return payload.contracts;
  if (Array.isArray(payload)) return payload;
  return [];
}

function parseMassiveNextUrl(nextUrl: string | null | undefined): { path: string; params: Record<string, any> } | null {
  if (!nextUrl || typeof nextUrl !== 'string') return null;
  try {
    const parsed = new URL(nextUrl);
    const params: Record<string, any> = {};
    parsed.searchParams.forEach((value, key) => {
      if (!key) return;
      if (key.toLowerCase() === 'apikey') return;
      params[key] = value;
    });
    const path = parsed.pathname.startsWith('/') ? parsed.pathname : `/${parsed.pathname}`;
    return { path, params };
  } catch (error) {
    console.warn('[MASSIVE] failed to parse next_url', nextUrl, error);
    return null;
  }
}

/**
 * Builds a normalized option chain by combining Massive snapshots and
 * reference contracts. Handles pagination, expiration filters, and caching.
 */
export type OptionsChainFilters = {
  expiration?: string;
  /** Inclusive expiration-date range (YYYY-MM-DD). Narrows the provider query. */
  expirationGte?: string;
  expirationLte?: string;
  /** calls-only / puts-only fetches for direction-specific consumers. */
  contractType?: 'call' | 'put';
  /** Inclusive strike range. Narrows the provider query. */
  strikeGte?: number;
  strikeLte?: number;
  /** Queue priority for every request this chain build issues. */
  priority?: RequestPriority;
  /**
   * Cache TTL for the reference-contract pages. Reference data is static per
   * contract, so orchestrated callers pass a long TTL to avoid re-downloading
   * contract definitions on every snapshot/quote refresh.
   */
  referenceCacheTtlMs?: number;
  /**
   * Cache TTL for snapshot pages. The orchestrator sets 0 and applies its own
   * market-session-aware chain cache instead of double-caching here.
   */
  snapshotCacheTtlMs?: number;
};

export async function getMassiveOptionsChain(
  underlying: string,
  limit = 100,
  order: 'asc' | 'desc' = 'asc',
  sort: string = 'ticker',
  options: OptionsChainFilters = {}
) {
  const normalizedUnderlying = underlying.toUpperCase();
  const normalizedExpirationFilter = options.expiration ? normalizeExpirationDate(options.expiration) ?? undefined : undefined;
  const expirationGte = options.expirationGte ? normalizeExpirationDate(options.expirationGte) ?? undefined : undefined;
  const expirationLte = options.expirationLte ? normalizeExpirationDate(options.expirationLte) ?? undefined : undefined;
  const hasWindowFilter = Boolean(normalizedExpirationFilter || (expirationGte && expirationLte));
  const clampedLimit = clampChainLimit(limit);
  const priority = options.priority;
  const snapshotParams: Record<string, any> = {
    order,
    limit: Math.min(clampedLimit, MASSIVE_SNAPSHOT_PAGE_LIMIT),
    sort
  };
  if (normalizedExpirationFilter) {
    snapshotParams.expiration_date = normalizedExpirationFilter;
  } else {
    if (expirationGte) snapshotParams['expiration_date.gte'] = expirationGte;
    if (expirationLte) snapshotParams['expiration_date.lte'] = expirationLte;
  }
  if (options.contractType === 'call' || options.contractType === 'put') {
    snapshotParams.contract_type = options.contractType;
  }
  if (typeof options.strikeGte === 'number' && Number.isFinite(options.strikeGte)) {
    snapshotParams['strike_price.gte'] = options.strikeGte;
  }
  if (typeof options.strikeLte === 'number' && Number.isFinite(options.strikeLte)) {
    snapshotParams['strike_price.lte'] = options.strikeLte;
  }
  let snapshotData: Awaited<ReturnType<typeof fetchSnapshotOptions>> | null = null;
  try {
    snapshotData = await fetchSnapshotOptions(
      normalizedUnderlying,
      snapshotParams,
      {
        maxPages: hasWindowFilter ? MASSIVE_SNAPSHOT_MAX_PAGES : 5,
        priority,
        cacheTtlMs: options.snapshotCacheTtlMs
      }
    );
  } catch (error) {
    console.warn('[MASSIVE] snapshot chain fetch failed for', normalizedUnderlying, (error as Error)?.message);
  }

  const snapshotRoot = snapshotData?.root ?? {};
  const underlyingAsset =
    snapshotData?.underlyingAsset ??
    snapshotRoot?.underlying_asset ??
    snapshotRoot?.underlying ??
    {};
  const underlyingPrice = resolveNumber(underlyingAsset?.price) ?? null;
  const rawOptions = Array.isArray(snapshotData?.options) ? snapshotData.options : [];

  let referenceLegs = new Map<string, any>();
  let referenceStats: { pagesFetched: number; exhausted: boolean; nextCursor: string | null } = {
    pagesFetched: 0,
    exhausted: true,
    nextCursor: null
  };
  try {
    const referenceParams: Record<string, any> = {
      limit: clampedLimit,
      order,
      sort
    };
    applyReferenceUnderlyingFilter(referenceParams, normalizedUnderlying);
    if (normalizedExpirationFilter) {
      referenceParams.expiration_date = normalizedExpirationFilter;
    } else {
      if (expirationGte) referenceParams['expiration_date.gte'] = expirationGte;
      if (expirationLte) referenceParams['expiration_date.lte'] = expirationLte;
    }
    if (options.contractType === 'call' || options.contractType === 'put') {
      referenceParams.contract_type = options.contractType;
    }
    if (typeof options.strikeGte === 'number' && Number.isFinite(options.strikeGte)) {
      referenceParams['strike_price.gte'] = options.strikeGte;
    }
    if (typeof options.strikeLte === 'number' && Number.isFinite(options.strikeLte)) {
      referenceParams['strike_price.lte'] = options.strikeLte;
    }
    const {
      results: contracts,
      pagesFetched,
      exhausted,
      nextCursor
    } = await fetchReferenceContracts(referenceParams, {
      maxPages: hasWindowFilter ? MASSIVE_REFERENCE_MAX_PAGES : 1,
      priority,
      cacheTtlMs: options.referenceCacheTtlMs
    });
    referenceStats = { pagesFetched, exhausted, nextCursor };
    if (!exhausted) {
      console.warn('[MASSIVE] reference contracts truncated', {
        ticker: normalizedUnderlying,
        expiration: normalizedExpirationFilter,
        pagesFetched,
        requestLimit: clampedLimit
      });
    }
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
    if (contracts.length === 0) {
      logOptionReferenceEmpty('CHAIN_REFERENCE_EMPTY', {
        underlying: normalizedUnderlying,
        expiration: normalizedExpirationFilter ?? null,
        expirationGte: expirationGte ?? null,
        expirationLte: expirationLte ?? null,
        contractType: options.contractType ?? null,
        strikeGte: options.strikeGte ?? null,
        strikeLte: options.strikeLte ?? null,
        limit: clampedLimit,
        pagesFetched,
        nextCursor: logHash(nextCursor),
      });
    }
  } catch (error) {
    console.warn('[MASSIVE] reference contracts fetch failed for', normalizedUnderlying, error);
  }

  const expirationMap = new Map<string, Map<number, any>>();
  const seenTickers = new Set<string>();

  function upsertStrike(rawExpiration: string | null | undefined, strike: number, call: any, put: any) {
    const expiration = normalizeExpirationDate(rawExpiration);
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
    const expiration = normalizeExpirationDate(
      typeof optionEntry?.expiration_date === 'string'
        ? optionEntry.expiration_date
        : typeof optionEntry?.expiration === 'string'
          ? optionEntry.expiration
          : typeof optionDetails?.expiration_date === 'string'
            ? optionDetails.expiration_date
            : typeof optionDetails?.expiration === 'string'
              ? optionDetails.expiration
              : undefined
    );
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
      const expirationKey = leg.expiration;
      const strikesForExpiration = expirationMap.get(expirationKey) ?? new Map<number, any>();
      const row = strikesForExpiration.get(strike) ?? { strike, call: undefined, put: undefined };
      if (contractType === 'call') row.call = leg;
      else row.put = leg;
      strikesForExpiration.set(strike, row);
      expirationMap.set(expirationKey, strikesForExpiration);
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

  if (normalizedExpirationFilter) {
    expirations = expirations.filter(group => group.expiration === normalizedExpirationFilter);
  } else {
    if (expirationGte) expirations = expirations.filter(group => group.expiration >= expirationGte);
    if (expirationLte) expirations = expirations.filter(group => group.expiration <= expirationLte);
  }
  // Expired contracts must never surface in a chain (negative DTE correction).
  expirations = expirations.filter(group => group.dte == null || group.dte >= 0);

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
    let fallbackExpirations = Array.from(fallbackMap.entries())
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

    if (normalizedExpirationFilter) {
      fallbackExpirations = fallbackExpirations.filter(group => group.expiration === normalizedExpirationFilter);
    } else {
      if (expirationGte) fallbackExpirations = fallbackExpirations.filter(group => group.expiration >= expirationGte);
      if (expirationLte) fallbackExpirations = fallbackExpirations.filter(group => group.expiration <= expirationLte);
    }
    fallbackExpirations = fallbackExpirations.filter(group => group.dte == null || group.dte >= 0);
    expirations = fallbackExpirations;
  }

  console.log('[MASSIVE] options chain resolved', {
    ticker: normalizedUnderlying,
    expirations: expirations.length,
    strikes: expirations.reduce((acc, group) => acc + group.strikes.length, 0),
    snapshotPages: snapshotData?.pagesFetched ?? 0,
    referencePages: referenceStats.pagesFetched
  });
  if (!expirations.length) {
    console.warn(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        service: 'massive-options-chain',
        event: 'CHAIN_EMPTY',
        underlying: normalizedUnderlying,
        expiration: normalizedExpirationFilter ?? null,
        expirationGte: expirationGte ?? null,
        expirationLte: expirationLte ?? null,
        contractType: options.contractType ?? null,
        strikeGte: options.strikeGte ?? null,
        strikeLte: options.strikeLte ?? null,
        snapshotOptions: rawOptions.length,
        referenceContracts: referenceLegs.size,
        snapshotPages: snapshotData?.pagesFetched ?? 0,
        referencePages: referenceStats.pagesFetched,
        referenceNextCursor: logHash(referenceStats.nextCursor),
      })
    );
  }

  const coveredExpirations = expirations.map(group => group.expiration).sort();

  return {
    ticker: normalizedUnderlying,
    underlyingPrice,
    underlyingContext: {
      price: underlyingPrice,
      ticker: typeof underlyingAsset?.ticker === 'string' ? underlyingAsset.ticker : normalizedUnderlying,
      lastUpdated: normalizeProviderTimestamp(underlyingAsset?.last_updated),
      timeframe:
        typeof underlyingAsset?.timeframe === 'string' ? underlyingAsset.timeframe.toUpperCase() : 'UNKNOWN',
      source: 'options-snapshot' as const
    },
    expirations,
    metadata: {
      limit: clampedLimit,
      referenceContracts: referenceLegs.size,
      referencePages: referenceStats.pagesFetched,
      referenceComplete: referenceStats.exhausted,
      referenceNextCursor: referenceStats.nextCursor,
      snapshotPages: snapshotData?.pagesFetched ?? 0,
      snapshotComplete: snapshotData?.exhausted ?? false,
      snapshotNextCursor: snapshotData?.nextCursor ?? null,
      expiration: normalizedExpirationFilter ?? null,
      expirationGte: expirationGte ?? null,
      expirationLte: expirationLte ?? null,
      contractType: options.contractType ?? null,
      coveredExpirationStart: coveredExpirations[0] ?? null,
      coveredExpirationEnd: coveredExpirations[coveredExpirations.length - 1] ?? null,
      fetchedAt: new Date().toISOString()
    }
  };
}

/**
 * Massive timestamps arrive in ns / µs / ms / s depending on the field.
 * Normalize to epoch milliseconds.
 */
export function normalizeProviderTimestamp(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value > 1e17) return Math.floor(value / 1e6); // ns → ms
  if (value > 1e14) return Math.floor(value / 1e3); // µs → ms
  if (value > 1e11) return value; // already ms
  return Math.floor(value * 1000); // s → ms
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

// DTE in exchange (America/New_York) calendar days. Same-day expirations are 0,
// never -1 (see shared/time/tradingCalendar.ts for the UTC-midnight bug this fixes).
function computeDte(expiration: string): number | null {
  return computeDteEt(expiration, Date.now());
}

export function normalizeExpirationDate(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }
  const isoPrefixMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoPrefixMatch) {
    return `${isoPrefixMatch[1]}-${isoPrefixMatch[2]}-${isoPrefixMatch[3]}`;
  }
  const digitsMatch = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (digitsMatch) {
    return `${digitsMatch[1]}-${digitsMatch[2]}-${digitsMatch[3]}`;
  }
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  const date = new Date(parsed);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeSnapshotLeg(
  raw: any,
  strike: number,
  expiration: string | null | undefined,
  type: 'call' | 'put',
  underlyingPrice: number | null,
  underlyingSymbol: string,
  fallback?: any
) {
  if (!raw) return null;
  const normalizedExpiration = normalizeExpirationDate(expiration);
  if (!normalizedExpiration) return null;
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
    expiration: normalizedExpiration,
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

export function normalizeReferenceContract(contract: any, underlyingSymbol: string) {
  const ticker =
    typeof contract?.ticker === 'string' ? contract.ticker.toUpperCase() : null;
  if (!ticker) return null;
  const strike = Number(contract.strike_price ?? contract.strike);
  if (Number.isNaN(strike)) return null;
  const expiration = normalizeExpirationDate(
    typeof contract?.expiration_date === 'string'
      ? contract.expiration_date
      : contract?.expiration
  );
  if (!expiration) return null;
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
  const greeksRaw = detail.greeks ?? {};
  const delta = resolveNumber(greeksRaw.delta);
  const gamma = resolveNumber(greeksRaw.gamma);
  const theta = resolveNumber(greeksRaw.theta);
  const vega = resolveNumber(greeksRaw.vega);
  const rho = resolveNumber(greeksRaw.rho);
  const greeks = {
    ...(delta != null ? { delta } : {}),
    ...(gamma != null ? { gamma } : {}),
    ...(theta != null ? { theta } : {}),
    ...(vega != null ? { vega } : {}),
    ...(rho != null ? { rho } : {}),
  };
  const expiration =
    normalizeExpirationDate(
      typeof detail?.expiration_date === 'string'
        ? detail.expiration_date
        : typeof detail?.expiration === 'string'
          ? detail.expiration
          : undefined
    ) ?? undefined;
  return {
    ticker: detail.ticker ?? fallbackTicker,
    underlying: detail.underlying_ticker,
    expiration,
    type: detail.contract_type,
    strike: detail.strike_price,
    openInterest: detail.open_interest,
    breakEvenPrice: detail.break_even_price,
    impliedVolatility: detail.implied_volatility,
    day: detail.day,
    greeks,
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

export function extractCursor(nextUrl: string | null | undefined) {
  if (!nextUrl || typeof nextUrl !== 'string') return null;
  try {
    const parsed = new URL(nextUrl);
    const cursorParam = parsed.searchParams.get('cursor');
    if (cursorParam) return cursorParam;
  } catch {
    // ignore invalid URLs
  }
  const match = nextUrl.match(/cursor=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Retrieves Massive's option snapshot for an underlying. Used to seed the
 * watchlist/checklist modules with top-volume contracts and greeks.
 */
export async function getMassiveOptionsSnapshot(
  underlying: string,
  options: { priority?: RequestPriority; cacheTtlMs?: number } = {}
) {
  const symbol = underlying.toUpperCase();
  const requestOptions = {
    cacheTtlMs: options.cacheTtlMs ?? 5_000,
    priority: options.priority,
  };
  let payload: any;
  try {
    payload = await massiveGet(`/v3/snapshot/options/${symbol}`, {}, requestOptions);
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    console.warn('[MASSIVE] v3 snapshot missing for', symbol, '– falling back to v2');
    payload = await massiveGet(`/v2/snapshot/options/${symbol}`, {}, requestOptions);
  }
  console.log('[MASSIVE] snapshot payload summary', {
    symbol,
    results: Array.isArray(payload?.results) ? payload.results.length : null,
    status: payload?.status ?? null
  });
  const result = Array.isArray(payload?.results) ? payload.results[0] ?? {} : payload?.results ?? payload ?? {};
  const underlyingAsset = extractSnapshotUnderlying(payload) ?? result?.underlying_asset ?? result?.underlying ?? {};
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
    // Provider metadata so consumers can label freshness honestly: under
    // Options Advanced the underlying block is DELAYED, never real-time.
    priceLastUpdated: normalizeProviderTimestamp(underlyingAsset?.last_updated),
    priceTimeframe:
      typeof underlyingAsset?.timeframe === 'string' ? underlyingAsset.timeframe.toUpperCase() : 'UNKNOWN',
    change,
    changePercent,
    dayHigh: resolveNumber(underlyingDay?.high),
    dayLow: resolveNumber(underlyingDay?.low),
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

export type HeldContractQuote = {
  bid: number | null;
  ask: number | null;
  mid: number | null;
  price: number | null;
  /** Provider quote timestamp (ms epoch) from the contract's own last_quote. */
  quoteTimestamp: number | null;
};

/**
 * Narrowest authorized held-contract quote: ONE direct option-contract snapshot
 * by OCC symbol (`/v3/snapshot/options/{underlying}/{contract}`), no reference
 * pages, no chain pagination. Routed through `massiveGet`, so it inherits the
 * shared request manager: in-flight dedup (a UI and the monitor asking for the
 * same contract share one request), TTL cache, priority queue, and Retry-After
 * backoff. Callers pass `REQUEST_PRIORITY.OPEN_POSITION` so a held-position mark
 * outranks watchlist/research refreshes. The underlying is taken from the OCC
 * symbol — no metadata round-trip is needed to build the URL.
 */
export async function getMassiveOptionQuoteSnapshot(
  underlying: string,
  contractTicker: string,
  options: { cacheTtlMs?: number; priority?: RequestPriority } = {}
): Promise<HeldContractQuote> {
  const u = underlying.toUpperCase().replace(/^O:/, '');
  const c = contractTicker.toUpperCase();
  const requestOptions = {
    cacheTtlMs: options.cacheTtlMs ?? 3_000,
    priority: options.priority ?? REQUEST_PRIORITY.OPEN_POSITION,
  };
  let snapshot: any;
  try {
    snapshot = await massiveGet(`/v3/snapshot/options/${u}/${c}`, {}, requestOptions);
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    snapshot = await massiveGet(`/v2/snapshot/options/${u}/${c}`, {}, requestOptions);
  }
  const payload = snapshot?.results ?? snapshot ?? {};
  const optionData = payload?.option ?? payload ?? {};
  const lastQuote = optionData?.last_quote ?? optionData?.lastQuote ?? {};
  const lastTrade = optionData?.last_trade ?? optionData?.lastTrade ?? {};
  const day = optionData?.day ?? {};
  const bid = resolveNumber(lastQuote?.bid);
  const ask = resolveNumber(lastQuote?.ask);
  const mid = computeMid(lastQuote?.bid, lastQuote?.ask);
  const price = resolveNumber(lastTrade?.price) ?? mid ?? resolveNumber(day?.close);
  const quoteTimestamp = normalizeProviderTimestamp(
    lastQuote?.last_updated ?? lastQuote?.sip_timestamp ?? lastQuote?.timestamp ?? lastQuote?.t
  );
  return { bid, ask, mid, price, quoteTimestamp };
}

/**
 * Fetches the snapshot for a specific contract (bid/ask/last, greeks, etc.).
 */
export async function getMassiveOptionContractSnapshot(
  contractTicker: string,
  options: { priority?: RequestPriority; cacheTtlMs?: number } = {}
) {
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
      { cacheTtlMs: options.cacheTtlMs ?? 3_000, priority: options.priority }
    );
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    console.warn('[MASSIVE] v3 contract snapshot missing for', contractSymbol, '– falling back to v2');
    snapshot = await massiveGet(
      `/v2/snapshot/options/${underlyingSymbol}/${contractSymbol}`,
      {},
      { cacheTtlMs: options.cacheTtlMs ?? 3_000, priority: options.priority }
    );
  }
  console.log('[MASSIVE] contract snapshot resolved payload', {
    contract: contractSymbol,
    hasResults: snapshot?.results != null,
    status: snapshot?.status ?? null
  });
  const payload = snapshot?.results ?? snapshot ?? {};
  const optionData = payload?.option ?? payload ?? {};
  const priceData = optionData?.price_data ?? optionData?.priceData ?? optionData?.pricing ?? null;
  const day = optionData?.day ?? contractDetail.day ?? {};
  const lastQuote = optionData?.last_quote ?? contractDetail.lastQuote ?? {};
  const lastTrade = optionData?.last_trade ?? contractDetail.lastTrade ?? {};
  const price =
    resolveNumber(lastTrade?.price) ??
    computeMid(lastQuote?.bid, lastQuote?.ask) ??
    resolveNumber(day?.close);
  const greeksRaw = {
    ...(priceData?.greeks ?? {}),
    ...(optionData?.greeks ?? {}),
    ...(contractDetail.greeks ?? {})
  };
  const delta = resolveNumber(greeksRaw.delta);
  const gamma = resolveNumber(greeksRaw.gamma);
  const theta = resolveNumber(greeksRaw.theta);
  const vega = resolveNumber(greeksRaw.vega);
  const rho = resolveNumber(greeksRaw.rho);
  const greeks = {
    ...(delta != null ? { delta } : {}),
    ...(gamma != null ? { gamma } : {}),
    ...(theta != null ? { theta } : {}),
    ...(vega != null ? { vega } : {}),
    ...(rho != null ? { rho } : {})
  };
  const contractType = contractDetail.type;
  const strike = contractDetail.strike ?? optionData?.strike_price ?? null;
  const breakEvenPrice =
    contractDetail.breakEvenPrice ??
    (typeof strike === 'number' && typeof price === 'number' && contractType
      ? contractType === 'call'
        ? strike + price
        : strike - price
      : null);



  const normalizedSnapshot = {
    contract: contractSymbol,
    ticker: contractSymbol,
    underlying: underlyingSymbol,
    expiration:
      normalizeExpirationDate(contractDetail.expiration ?? optionData?.expiration_date) ??
      contractDetail.expiration ??
      optionData?.expiration_date ??
      undefined,
    type: contractType,
    strike,
    openInterest: resolveNumber(optionData?.open_interest ?? contractDetail.openInterest),
    breakEvenPrice: breakEvenPrice ?? undefined,
    impliedVolatility: resolveNumber(optionData?.implied_volatility ?? contractDetail.impliedVolatility),
    day,
    greeks,
    lastQuote,
    lastTrade,
    price,
    bid: resolveNumber(lastQuote?.bid),
    ask: resolveNumber(lastQuote?.ask),
    mid: computeMid(lastQuote?.bid, lastQuote?.ask),
    change: resolveNumber(day?.change ?? day?.change_percent),
    changePercent: resolveNumber(day?.change_percent),
    volume: resolveNumber(day?.volume ?? optionData?.volume),
  };
  console.log('[MASSIVE] contract snapshot resolved', {
    contract: normalizedSnapshot.contract,
    underlying: normalizedSnapshot.underlying,
    price: normalizedSnapshot.price
  });
  return normalizedSnapshot;
}

/**
 * Retrieves a snapshot for a stock ticker.
 */
/**
 * Retrieves a snapshot for a stock ticker.
 * Note: Falls back to previous close endpoint if real-time snapshot is forbidden (e.g. free tier).
 */
export async function getMassiveStockSnapshot(
  ticker: string,
  options: { priority?: RequestPriority; cacheTtlMs?: number } = {}
) {
  const symbol = ticker.toUpperCase();
  // Try previous close first as it's available on all plans (including free).
  // Real-time snapshots require paid plans and return 403 on free tier.
  const payload = await massiveGet(
    `/v2/aggs/ticker/${symbol}/prev`,
    {},
    { cacheTtlMs: options.cacheTtlMs ?? 60_000, priority: options.priority }
  );

  const result = payload?.results?.[0] ?? {};

  // Map Aggregates v2 response to WatchlistSnapshot
  // { T: 'SPY', c: 500.0, o: 498.0, ... }

  const price = resolveNumber(result.c);
  // We use open as a proxy for previous close to calculate strictly intraday change 
  // since we don't have the T-2 close here. 
  // Ideally, we'd fetch the last 2 days of aggs to get accurate change.
  const open = resolveNumber(result.o);

  const change = price != null && open != null ? price - open : null;
  const changePercent = price != null && open != null
    ? ((price - open) / open) * 100
    : null;

  const snapshotResult = {
    ticker: symbol,
    name: symbol,
    price,
    change,
    changePercent,
    dayHigh: resolveNumber(result.h),
    dayLow: resolveNumber(result.l),
    volume: resolveNumber(result.v),
    updated: result.t, // Timestamp of the bar's start usually
    source: 'prev_close' // Debug helper
  };

  console.log('[MASSIVE] stock snapshot resolved (prev)', {
    ticker: snapshotResult.ticker,
    price: snapshotResult.price
  });

  return snapshotResult;
}

type ShortInterestEntry = {
  ticker: string;
  settlementDate: string | null;
  shortInterest: number | null;
  avgDailyVolume: number | null;
  daysToCover: number | null;
};

type ShortVolumeVenueBreakdown = {
  adfShortVolume?: number | null;
  adfShortVolumeExempt?: number | null;
  nasdaqCarteretShortVolume?: number | null;
  nasdaqCarteretShortVolumeExempt?: number | null;
  nasdaqChicagoShortVolume?: number | null;
  nasdaqChicagoShortVolumeExempt?: number | null;
  nyseShortVolume?: number | null;
  nyseShortVolumeExempt?: number | null;
};

type ShortVolumeEntry = {
  ticker: string;
  date: string | null;
  shortVolume: number | null;
  shortVolumeRatio: number | null;
  totalVolume: number | null;
  nonExemptVolume: number | null;
  exemptVolume: number | null;
  venues?: ShortVolumeVenueBreakdown;
};

type ShortInterestQuery = {
  ticker: string;
  from?: string;
  to?: string;
  limit?: number;
  sort?: string;
  order?: SortDirection;
};

type ShortVolumeQuery = {
  ticker: string;
  from?: string;
  to?: string;
  limit?: number;
  sort?: string;
  order?: SortDirection;
};

function normalizeShortDate(value: string | null | undefined) {
  if (!value) return undefined;
  return normalizeExpirationDate(value) ?? value;
}

/**
 * Pulls short interest metrics for an underlying ticker (bi-monthly reports).
 */
export async function getMassiveShortInterest(query: ShortInterestQuery) {
  const ticker = query.ticker.toUpperCase();
  const params: Record<string, any> = { ticker };
  const from = normalizeShortDate(query.from);
  const to = normalizeShortDate(query.to);
  if (from) params['settlement_date.gte'] = from;
  if (to) params['settlement_date.lte'] = to;
  const limitParam = Number(query.limit ?? 25) || 25;
  params.limit = Math.min(Math.max(limitParam, 1), 500);
  if (query.sort) params.sort = query.sort;
  if (query.order) params.order = query.order;

  const payload = await massiveGet('/stocks/v1/short-interest', params, { cacheTtlMs: 6 * 60 * 60 * 1000 });
  const raw = Array.isArray(payload?.results) ? payload.results : [];
  const results: ShortInterestEntry[] = raw.map((entry: any) => ({
    ticker: typeof entry?.ticker === 'string' ? entry.ticker.toUpperCase() : ticker,
    settlementDate: entry?.settlement_date ?? entry?.settlementDate ?? null,
    shortInterest: resolveNumber(entry?.short_interest ?? entry?.shortInterest),
    avgDailyVolume: resolveNumber(entry?.avg_daily_volume ?? entry?.avgDailyVolume),
    daysToCover: resolveNumber(entry?.days_to_cover ?? entry?.daysToCover)
  }));

  console.log('[MASSIVE] short interest resolved', {
    ticker,
    count: results.length,
    from,
    to
  });

  return { ticker, results };
}

/**
 * Pulls short volume metrics for an underlying ticker (daily reports).
 */
export async function getMassiveShortVolume(query: ShortVolumeQuery) {
  const ticker = query.ticker.toUpperCase();
  const params: Record<string, any> = { ticker };
  const from = normalizeShortDate(query.from);
  const to = normalizeShortDate(query.to);
  if (from) params['date.gte'] = from;
  if (to) params['date.lte'] = to;
  const limitParam = Number(query.limit ?? 30) || 30;
  params.limit = Math.min(Math.max(limitParam, 1), 500);
  if (query.sort) params.sort = query.sort;
  if (query.order) params.order = query.order;

  const payload = await massiveGet('/stocks/v1/short-volume', params, { cacheTtlMs: 15 * 60 * 1000 });
  const raw = Array.isArray(payload?.results) ? payload.results : [];
  const results: ShortVolumeEntry[] = raw.map((entry: any) => ({
    ticker: typeof entry?.ticker === 'string' ? entry.ticker.toUpperCase() : ticker,
    date: entry?.date ?? null,
    shortVolume: resolveNumber(entry?.short_volume ?? entry?.shortVolume),
    shortVolumeRatio: resolveNumber(entry?.short_volume_ratio ?? entry?.shortVolumeRatio),
    totalVolume: resolveNumber(entry?.total_volume ?? entry?.totalVolume),
    nonExemptVolume: resolveNumber(entry?.non_exempt_volume ?? entry?.nonExemptVolume),
    exemptVolume: resolveNumber(entry?.exempt_volume ?? entry?.exemptVolume),
    venues: {
      adfShortVolume: resolveNumber(entry?.adf_short_volume ?? entry?.adfShortVolume),
      adfShortVolumeExempt: resolveNumber(entry?.adf_short_volume_exempt ?? entry?.adfShortVolumeExempt),
      nasdaqCarteretShortVolume: resolveNumber(entry?.nasdaq_carteret_short_volume ?? entry?.nasdaqCarteretShortVolume),
      nasdaqCarteretShortVolumeExempt: resolveNumber(
        entry?.nasdaq_carteret_short_volume_exempt ?? entry?.nasdaqCarteretShortVolumeExempt
      ),
      nasdaqChicagoShortVolume: resolveNumber(entry?.nasdaq_chicago_short_volume ?? entry?.nasdaqChicagoShortVolume),
      nasdaqChicagoShortVolumeExempt: resolveNumber(
        entry?.nasdaq_chicago_short_volume_exempt ?? entry?.nasdaqChicagoShortVolumeExempt
      ),
      nyseShortVolume: resolveNumber(entry?.nyse_short_volume ?? entry?.nyseShortVolume),
      nyseShortVolumeExempt: resolveNumber(entry?.nyse_short_volume_exempt ?? entry?.nyseShortVolumeExempt)
    }
  }));

  console.log('[MASSIVE] short volume resolved', {
    ticker,
    count: results.length,
    from,
    to
  });

  return { ticker, results };
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

/**
 * Pulls indicator/time-series metadata for a contract. Used for the indicators
 * panel when available.
 */
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
