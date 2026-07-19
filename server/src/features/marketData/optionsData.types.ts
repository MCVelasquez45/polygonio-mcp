import type { RequestPriority } from '../../shared/data/massive';

// Shared types for the Options Market Data Orchestrator (Options Advanced
// alignment). All server-side consumers of SPY option data — automation,
// scanner, dashboard, contract detail — receive these normalized shapes from
// the orchestrator instead of calling Massive independently.

/** Explicit pagination-completeness metadata for a fetched chain window. */
export type ChainCompleteness = {
  complete: boolean;
  snapshotPagesFetched: number;
  referencePagesFetched: number;
  snapshotNextCursor: string | null;
  referenceNextCursor: string | null;
  truncated: boolean;
  truncationReason: string | null;
  coveredExpirationStart: string | null;
  coveredExpirationEnd: string | null;
  fetchedAt: string;
};

/**
 * Underlying context extracted from an authorized options-snapshot response.
 * Under Options Advanced the underlying block is DELAYED — the timeframe is
 * carried so no consumer can mistake it for a real-time quote.
 */
export type UnderlyingContext = {
  ticker: string;
  price: number | null;
  /** Provider timestamp of the underlying price (epoch ms), when supplied. */
  lastUpdated: number | null;
  /** REAL-TIME | DELAYED | UNKNOWN as reported by Massive. */
  timeframe: string;
  source: 'options-snapshot';
};

export type ChainCacheStatus = 'fresh' | 'cached' | 'stale';

/** Normalized request for a chain window; equivalent requests coalesce. */
export type ChainWindowRequest = {
  underlying: string;
  contractType?: 'call' | 'put';
  /** Inclusive expiration window, YYYY-MM-DD exchange dates. */
  expirationGte?: string;
  expirationLte?: string;
  /** Single-expiration convenience (UI chain browser). */
  expiration?: string;
  strikeGte?: number;
  strikeLte?: number;
  limit?: number;
  priority?: RequestPriority;
};

/** Legacy UI chain shape (expirations → strikes → call/put legs) + metadata. */
export type OrchestratedChain = {
  ticker: string;
  underlyingPrice: number | null;
  underlyingContext: UnderlyingContext | null;
  expirations: Array<{
    expiration: string;
    dte: number | null;
    strikes: Array<{ strike: number; call?: any; put?: any }>;
  }>;
  completeness: ChainCompleteness;
  cacheStatus: ChainCacheStatus;
  /** Stale reason when cacheStatus === 'stale' (served past TTL after a failure). */
  staleReason: string | null;
  metadata: Record<string, unknown>;
};

export type OptionsRestStatus = 'OK' | 'DEGRADED' | 'UNAVAILABLE';

export type OptionsStreamStatus = 'CONNECTED' | 'DEGRADED' | 'UNAVAILABLE' | 'DISABLED';

export type MarketDataHealthReport = {
  timestamp: string;
  subscriptionProfile: string;
  capabilityVerification: {
    method: string;
    verifiedAt: string;
    notes: string;
  };
  optionsRest: {
    status: OptionsRestStatus;
    lastSuccessAt: string | null;
    lastErrorAt: string | null;
    lastError: string | null;
  };
  optionsWebSocket: {
    status: OptionsStreamStatus;
    state: Record<string, unknown> | null;
    activeSubscriptions: number;
  };
  underlyingData: {
    source: 'options-snapshot-delayed' | 'unavailable';
    entitlement: 'delayed-only' | 'unauthorized-realtime-intraday';
    lastUpdate: string | null;
  };
  lastOptionUpdateAt: string | null;
  caches: {
    snapshotAgeMs: number | null;
    referenceAgeMs: number | null;
    chainCompleteness: ChainCompleteness | null;
  };
  throttle: {
    entitlementBlocks: Record<string, { until: string; message: string }>;
    pendingRequestsByPriority: Record<string, number>;
  };
  reconnect: {
    attempts: number;
    nextAttemptAt: string | null;
  };
  automationDataReady: boolean;
  automationDataReadyReasons: string[];
};
