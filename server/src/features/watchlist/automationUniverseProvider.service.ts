import mongoose from 'mongoose';
import { logAutomationEvent } from '../automation/services/automationAudit.service';
import { envNumberClamped } from './watchlist.util';
import {
  ACTIVE_WATCHLIST_STRATEGY,
  WatchlistItemModel,
  type WatchlistStrategy,
} from './watchlist.model';

// Sprint 2E — the Automation Universe Provider.
//
// DECISION: runtime-refresh Option B (cached read + refresh) over a Mongo change
// stream. Rationale: change streams require a replica set (local standalone Mongo
// and mongodb-memory-server single-node do NOT support them without extra setup),
// add a long-lived cursor to babysit, and buy little here — the universe changes
// on human timescales. A short-TTL cache is the simplest RELIABLE option, and we
// additionally invalidate the cache on every watchlist WRITE so operator changes
// are effective immediately (not merely within the TTL). No server restart is
// ever required to pick up a watchlist change.

export type WatchlistUniverseSymbol = {
  symbol: string;
  priority: number;
  strategy: WatchlistStrategy;
  minConfidence: number;
  maxPositionSize: number;
  maxSpreadPercent: number;
  minDTE: number;
  maxDTE: number;
  minimumOpenInterest: number | null;
  minimumVolume: number | null;
};

export type AutomationUniverse = {
  /** Active-strategy symbols only, ranked by priority asc then symbol. */
  symbols: string[];
  items: Record<string, WatchlistUniverseSymbol>;
  /** Symbols excluded this cycle with a reason (e.g. future strategy). */
  skipped: { symbol: string; reason: string }[];
  empty: boolean;
  source: 'watchlist';
  loadedAt: number;
};

// Cache TTL. `AUTOMATION_WATCHLIST_CACHE_TTL_MS` is the documented name;
// `AUTOMATION_WATCHLIST_REFRESH_MS` is accepted as a backward-compatible alias.
const REFRESH_TTL_MS = envNumberClamped(
  process.env.AUTOMATION_WATCHLIST_CACHE_TTL_MS != null
    ? 'AUTOMATION_WATCHLIST_CACHE_TTL_MS'
    : 'AUTOMATION_WATCHLIST_REFRESH_MS',
  30_000,
  15_000,
  60_000
);

let cache: AutomationUniverse | null = null;

function emptyUniverse(now: number): AutomationUniverse {
  return { symbols: [], items: {}, skipped: [], empty: true, source: 'watchlist', loadedAt: now };
}

/**
 * Reload the universe from the watchlist collection and refresh the cache.
 * Never throws into the trading path — a DB failure fails CLOSED (empty
 * universe). Emits the structured cycle logs.
 */
export async function refreshAutomationUniverse(now: number = Date.now()): Promise<AutomationUniverse> {
  if (mongoose.connection?.readyState !== 1) {
    cache = emptyUniverse(now);
    logAutomationEvent({
      service: 'watchlist',
      event: 'WATCHLIST_EMPTY',
      severity: 'warning',
      payload: { reason: 'MONGO_UNAVAILABLE' },
    });
    return cache;
  }

  let docs;
  try {
    docs = await WatchlistItemModel.find({ enabled: true, automationEnabled: true }).sort({ priority: 1, symbol: 1 });
  } catch (error: any) {
    cache = emptyUniverse(now);
    logAutomationEvent({
      service: 'watchlist',
      event: 'WATCHLIST_EMPTY',
      severity: 'warning',
      payload: { reason: 'LOAD_FAILED', error: String(error?.message ?? error) },
    });
    return cache;
  }

  const items: Record<string, WatchlistUniverseSymbol> = {};
  const symbols: string[] = [];
  const skipped: { symbol: string; reason: string }[] = [];

  for (const doc of docs) {
    // The architecture supports many strategies; only the active one is wired.
    // The primary `strategy` field is the gate; `allowedStrategies` is recorded
    // metadata for future multi-strategy routing (not yet a gate).
    if (doc.strategy !== ACTIVE_WATCHLIST_STRATEGY) {
      skipped.push({ symbol: doc.symbol, reason: 'WATCHLIST_STRATEGY_INACTIVE' });
      logAutomationEvent({
        service: 'watchlist',
        event: 'WATCHLIST_SYMBOL_SKIPPED',
        automationSessionId: undefined,
        symbol: doc.symbol,
        payload: { reason: 'WATCHLIST_STRATEGY_INACTIVE', strategy: doc.strategy },
      });
      continue;
    }
    symbols.push(doc.symbol);
    items[doc.symbol] = {
      symbol: doc.symbol,
      priority: doc.priority,
      strategy: doc.strategy,
      minConfidence: doc.minConfidence,
      maxPositionSize: doc.maxPositionSize,
      maxSpreadPercent: doc.maxSpreadPercent,
      minDTE: doc.minDTE,
      maxDTE: doc.maxDTE,
      minimumOpenInterest: doc.minimumOpenInterest ?? null,
      minimumVolume: doc.minimumVolume ?? null,
    };
  }

  cache = { symbols, items, skipped, empty: symbols.length === 0, source: 'watchlist', loadedAt: now };

  logAutomationEvent({
    service: 'watchlist',
    event: 'WATCHLIST_REFRESH',
    payload: { loadedAt: new Date(now).toISOString(), ttlMs: REFRESH_TTL_MS },
  });
  logAutomationEvent({
    service: 'watchlist',
    event: 'WATCHLIST_LOADED',
    payload: { automationItems: docs.length, active: symbols.length, skipped: skipped.length },
  });
  logAutomationEvent({
    service: 'watchlist',
    event: 'WATCHLIST_SYMBOL_COUNT',
    payload: { count: symbols.length, symbols },
  });
  if (symbols.length === 0) {
    logAutomationEvent({
      service: 'watchlist',
      event: 'WATCHLIST_EMPTY',
      severity: 'warning',
      payload: { reason: docs.length === 0 ? 'NO_AUTOMATION_SYMBOLS' : 'ALL_SYMBOLS_INACTIVE_STRATEGY' },
    });
  }

  return cache;
}

/** Cached universe read. Refreshes when the cache is cold or past its TTL. */
export async function getAutomationUniverse(now: number = Date.now()): Promise<AutomationUniverse> {
  if (cache && now - cache.loadedAt < REFRESH_TTL_MS) {
    logAutomationEvent({
      service: 'watchlist',
      event: 'WATCHLIST_CACHE_HIT',
      payload: { ageMs: now - cache.loadedAt, ttlMs: REFRESH_TTL_MS, source: cache.source, symbolCount: cache.symbols.length },
    });
    return cache;
  }
  logAutomationEvent({
    service: 'watchlist',
    event: 'WATCHLIST_CACHE_MISS',
    payload: { reason: cache ? 'TTL_EXPIRED' : 'COLD', ttlMs: REFRESH_TTL_MS },
  });
  return refreshAutomationUniverse(now);
}

/** Drop the cache so the next read reloads immediately (called on every write). */
export function invalidateAutomationUniverseCache(): void {
  cache = null;
}

/** Test-only: reset provider state between cases. */
export function resetAutomationUniverseProviderForTests(): void {
  cache = null;
}

export function getAutomationUniverseRefreshTtlMs(): number {
  return REFRESH_TTL_MS;
}
