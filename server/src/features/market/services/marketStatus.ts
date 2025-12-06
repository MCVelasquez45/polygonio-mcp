import { massiveGet } from '../../../shared/data/massive';

export type MarketStatusSnapshot = {
  market: string;
  serverTime: Date;
  isWeekend: boolean;
  isHoliday: boolean;
  afterHours: boolean;
  preMarket: boolean;
  nextOpen?: string | null;
  nextClose?: string | null;
};

type RawMarketStatus = {
  market?: string;
  server_time?: string;
  is_weekend?: boolean;
  is_holiday?: boolean;
  after_hours?: boolean;
  pre_market?: boolean;
  next_open?: string | null;
  next_close?: string | null;
};

let cachedStatus: { expiresAt: number; value: MarketStatusSnapshot } | null = null;
const STATUS_TTL_MS = 30_000;

function toDate(value?: string | number | Date | null): Date {
  if (!value) return new Date();
  const timestamp = typeof value === 'number' ? value : Date.parse(String(value));
  if (Number.isNaN(timestamp)) return new Date();
  return new Date(timestamp);
}

function coerceSnapshot(raw: RawMarketStatus | null | undefined): MarketStatusSnapshot {
  const serverTime = toDate(raw?.server_time);
  return {
    market: raw?.market ?? 'unknown',
    serverTime,
    isWeekend: Boolean(raw?.is_weekend),
    isHoliday: Boolean(raw?.is_holiday),
    afterHours: Boolean(raw?.after_hours),
    preMarket: Boolean(raw?.pre_market),
    nextOpen: raw?.next_open ?? null,
    nextClose: raw?.next_close ?? null
  };
}

export async function getMarketStatusSnapshot(): Promise<MarketStatusSnapshot> {
  const now = Date.now();
  if (cachedStatus && cachedStatus.expiresAt > now) {
    return cachedStatus.value;
  }
  try {
    const payload = await massiveGet<RawMarketStatus>('/v1/marketstatus/now', {}, { cacheTtlMs: STATUS_TTL_MS / 2 });
    const snapshot = coerceSnapshot(payload);
    cachedStatus = { value: snapshot, expiresAt: now + STATUS_TTL_MS };
    return snapshot;
  } catch (error) {
    const fallback = coerceSnapshot(null);
    cachedStatus = { value: fallback, expiresAt: now + STATUS_TTL_MS };
    return fallback;
  }
}
