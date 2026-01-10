import type { Request } from 'express';

const RATE_LIMIT_WINDOW_MS = Number(process.env.AI_RATE_LIMIT_WINDOW_MS ?? 60_000);
const RATE_LIMIT_MAX = Number(process.env.AI_RATE_LIMIT_MAX ?? 20);
const DAILY_LIMIT = Number(process.env.AI_DAILY_CALL_LIMIT ?? 200);
const MAX_CONCURRENT = Math.max(1, Number(process.env.AI_MAX_CONCURRENT ?? 2));
const MAX_CONCURRENT_PER_USER = Math.max(1, Number(process.env.AI_MAX_CONCURRENT_PER_USER ?? 1));

type RateEntry = {
  windowStart: number;
  count: number;
};

type DailyEntry = {
  day: string;
  count: number;
};

const rateMap = new Map<string, RateEntry>();
const dailyMap = new Map<string, DailyEntry>();
const inflightByUser = new Map<string, number>();
let inflightTotal = 0;

export type AiLimitResult = {
  allowed: boolean;
  reason?: 'rate_limit' | 'daily_limit' | 'concurrency' | 'concurrency_user';
  retryAfterMs?: number;
  release?: () => void;
};

export function resolveAiUserKey(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const candidate = Array.isArray(forwarded)
    ? forwarded[0]
    : typeof forwarded === 'string'
    ? forwarded.split(',')[0]
    : req.ip;
  const trimmed = typeof candidate === 'string' ? candidate.trim() : '';
  return trimmed || 'unknown';
}

function msUntilNextUtcDay(now: Date): number {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));
  return next.getTime() - now.getTime();
}

export function acquireAiSlot(userKey: string, feature: string): AiLimitResult {
  const now = Date.now();
  const rateKey = `${userKey}:${feature}`;
  if (RATE_LIMIT_MAX > 0 && RATE_LIMIT_WINDOW_MS > 0) {
    const existing = rateMap.get(rateKey);
    const active = !existing || now - existing.windowStart >= RATE_LIMIT_WINDOW_MS
      ? { windowStart: now, count: 0 }
      : existing;
    if (active.count >= RATE_LIMIT_MAX) {
      const retryAfterMs = RATE_LIMIT_WINDOW_MS - (now - active.windowStart);
      return { allowed: false, reason: 'rate_limit', retryAfterMs };
    }
    rateMap.set(rateKey, active);
  }

  if (DAILY_LIMIT > 0) {
    const dayKey = userKey;
    const today = new Date().toISOString().slice(0, 10);
    const existing = dailyMap.get(dayKey);
    const active = !existing || existing.day !== today ? { day: today, count: 0 } : existing;
    if (active.count >= DAILY_LIMIT) {
      return { allowed: false, reason: 'daily_limit', retryAfterMs: msUntilNextUtcDay(new Date()) };
    }
    dailyMap.set(dayKey, active);
  }

  if (MAX_CONCURRENT > 0 && inflightTotal >= MAX_CONCURRENT) {
    return { allowed: false, reason: 'concurrency', retryAfterMs: 1_000 };
  }

  if (MAX_CONCURRENT_PER_USER > 0) {
    const userInflight = inflightByUser.get(userKey) ?? 0;
    if (userInflight >= MAX_CONCURRENT_PER_USER) {
      return { allowed: false, reason: 'concurrency_user', retryAfterMs: 1_000 };
    }
  }

  if (RATE_LIMIT_MAX > 0 && RATE_LIMIT_WINDOW_MS > 0) {
    const active = rateMap.get(rateKey);
    if (active) {
      active.count += 1;
    }
  }

  if (DAILY_LIMIT > 0) {
    const active = dailyMap.get(userKey);
    if (active) {
      active.count += 1;
    }
  }

  inflightTotal += 1;
  inflightByUser.set(userKey, (inflightByUser.get(userKey) ?? 0) + 1);

  return {
    allowed: true,
    release: () => {
      inflightTotal = Math.max(0, inflightTotal - 1);
      const current = inflightByUser.get(userKey) ?? 0;
      if (current <= 1) {
        inflightByUser.delete(userKey);
      } else {
        inflightByUser.set(userKey, current - 1);
      }
    }
  };
}
