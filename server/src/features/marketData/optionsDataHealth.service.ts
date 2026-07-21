import {
  getEntitlementBlocks,
  getPendingRequestsByPriority,
} from '../../shared/data/massive';
import {
  getActiveOptionSubscriptions,
  getOptionsWsConfig,
  getOptionsWsState,
  isOptionsStreamHealthy,
} from './optionsSubscriptionManager.service';
import { newestChainCacheAgeMs, latestCompleteness } from './optionsChainCache.service';
import { referenceCacheAgeMs } from './optionsContractCache.service';
import { getLastOptionTradeAt, getLastOptionUpdateAt, quoteCacheStats } from './optionsQuoteCache.service';
import type {
  MarketDataHealthReport,
  OptionsComponentStatus,
  OptionsRestStatus,
  OptionsStreamStatus,
} from './optionsData.types';

// Health registry for the options market-data pipeline. This is the single
// place that answers "is the data good enough for automation?" — and it
// answers NO whenever the required authoritative data is unavailable.

const EXPLICIT_SUBSCRIPTION_PROFILE = process.env.MASSIVE_SUBSCRIPTION_PROFILE?.trim().toLowerCase() || null;
const STOCKS_WS_FLAG_ENABLED = (process.env.MASSIVE_STOCKS_WS_ENABLED ?? 'false').toLowerCase() === 'true';

export const SUBSCRIPTION_PROFILE =
  EXPLICIT_SUBSCRIPTION_PROFILE ?? 'options-advanced';

/** Whether the configured plan includes real-time stock market data. */
export function stocksEntitled(): boolean {
  if (EXPLICIT_SUBSCRIPTION_PROFILE === 'options-advanced') return false;
  return STOCKS_WS_FLAG_ENABLED && EXPLICIT_SUBSCRIPTION_PROFILE != null;
}

const CAPABILITY_VERIFICATION = {
  method: 'massive-mcp + controlled REST probes (see docs/market-data/options-advanced-alignment-audit.md §7)',
  verifiedAt: '2026-07-13',
  notes:
    'Options REST/WS real-time confirmed. Underlying block in options snapshots is DELAYED. ' +
    'Current-day stock intraday aggregates return NOT_AUTHORIZED under this plan; the MCP exposes no entitlement API.',
};

const LIVE_QUOTE_FRESH_MS = Number(process.env.MASSIVE_OPTIONS_QUOTE_FRESH_MS ?? 10_000);

let lastRestSuccessAt: number | null = null;
let lastRestErrorAt: number | null = null;
let lastRestError: string | null = null;
let lastUnderlyingUpdateAt: number | null = null;

export function recordOptionsRestSuccess(underlyingLastUpdated: number | null): void {
  lastRestSuccessAt = Date.now();
  if (underlyingLastUpdated != null) lastUnderlyingUpdateAt = underlyingLastUpdated;
}

export function recordOptionsRestFailure(message: string): void {
  lastRestErrorAt = Date.now();
  lastRestError = message;
}

function restStatus(): OptionsRestStatus {
  if (lastRestSuccessAt == null && lastRestErrorAt == null) return 'OK'; // not yet exercised
  if (lastRestErrorAt != null && (lastRestSuccessAt == null || lastRestErrorAt > lastRestSuccessAt)) {
    // Most recent interaction failed.
    return lastRestSuccessAt != null && Date.now() - lastRestSuccessAt < 5 * 60_000 ? 'DEGRADED' : 'UNAVAILABLE';
  }
  return 'OK';
}

function streamStatus(): OptionsStreamStatus {
  const config = getOptionsWsConfig();
  if (!config.enabled) return 'DISABLED';
  const state = getOptionsWsState();
  if (!state) return 'DISABLED'; // no connection requested yet
  if (isOptionsStreamHealthy()) return 'CONNECTED';
  return state.reconnectAttempts > 3 ? 'UNAVAILABLE' : 'DEGRADED';
}

export function deriveOptionsComponentStatus(args: {
  socketIoConnected?: boolean;
  providerEnabled: boolean;
  providerConnected: boolean;
  providerAuthenticated: boolean;
  providerConnecting: boolean;
  providerStatus: string | null;
  activeContractCount: number;
  freshQuoteCount: number;
  hasSnapshotQuotes: boolean;
}): OptionsComponentStatus {
  if (args.socketIoConnected === false) return 'OFFLINE';
  if (args.providerStatus === 'max_connections' || args.providerStatus === 'auth_failed') return 'PROVIDER_BLOCKED';
  if (!args.providerEnabled) return args.hasSnapshotQuotes ? 'DEGRADED' : 'OFFLINE';
  if (args.providerConnecting || (args.providerConnected && !args.providerAuthenticated)) return 'CONNECTING';
  if (args.activeContractCount <= 0) return 'WAITING_FOR_CONTRACTS';
  if (args.providerConnected && args.providerAuthenticated && args.freshQuoteCount > 0) return 'LIVE';
  if (args.hasSnapshotQuotes) return 'DEGRADED';
  if (args.providerConnected || args.providerAuthenticated) return 'WAITING_FOR_QUOTES';
  return 'OFFLINE';
}

/**
 * Automation data readiness. Fails closed:
 *  - options REST must be healthy,
 *  - the latest chain window must be complete,
 *  - real-time underlying intraday bars are NOT part of this plan, so under
 *    the options-advanced profile readiness is false with an explicit reason
 *    (deterministic risk exits are NOT gated on this — entries are).
 */
export function automationDataReadiness(): { ready: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (restStatus() !== 'OK') reasons.push('OPTIONS_REST_' + restStatus());
  const completeness = latestCompleteness();
  if (completeness && !completeness.complete) reasons.push('CHAIN_INCOMPLETE');
  if (!stocksEntitled()) reasons.push('UNDERLYING_REALTIME_INTRADAY_UNAUTHORIZED');
  return { ready: reasons.length === 0, reasons };
}

export function buildMarketDataHealthReport(): MarketDataHealthReport {
  const config = getOptionsWsConfig();
  const wsState = getOptionsWsState();
  const readiness = automationDataReadiness();
  const lastOptionUpdate = getLastOptionUpdateAt();
  const lastOptionTrade = getLastOptionTradeAt();
  const activeSubscriptions = getActiveOptionSubscriptions();
  const cache = quoteCacheStats(LIVE_QUOTE_FRESH_MS);
  const componentStatus = deriveOptionsComponentStatus({
    providerEnabled: config.enabled,
    providerConnected: Boolean(wsState?.connected),
    providerAuthenticated: Boolean(wsState?.authenticated),
    providerConnecting: Boolean(wsState?.connecting),
    providerStatus: typeof wsState?.lastStatus === 'string' ? wsState.lastStatus : null,
    activeContractCount: activeSubscriptions.length,
    freshQuoteCount: cache.freshQuoteCount,
    hasSnapshotQuotes: cache.quoteCount > 0,
  });
  return {
    timestamp: new Date().toISOString(),
    service: 'options-market-data',
    productionMode: config.dataMode,
    subscriptionProfile: SUBSCRIPTION_PROFILE,
    capabilityVerification: CAPABILITY_VERIFICATION,
    provider: {
      optionsWebSocket: {
        enabled: config.enabled,
        endpoint: config.endpoint,
        dataMode: config.dataMode,
        connected: Boolean(wsState?.connected),
        authenticated: Boolean(wsState?.authenticated),
        connecting: Boolean(wsState?.connecting),
        lastStatus: typeof wsState?.lastStatus === 'string' ? wsState.lastStatus : null,
        lastStatusMessage: typeof wsState?.lastStatusMessage === 'string' ? wsState.lastStatusMessage : null,
        lastEventAt: wsState?.lastEventAt ?? null,
        lastQuoteAt: lastOptionUpdate ? new Date(lastOptionUpdate).toISOString() : null,
        lastTradeAt: lastOptionTrade ? new Date(lastOptionTrade).toISOString() : null,
        activeContracts: activeSubscriptions.length,
        reconnectAttempts: wsState?.reconnectAttempts ?? 0,
        nextReconnectAt: wsState?.nextReconnectAt ?? null,
      },
      stocksWebSocket: {
        enabled: STOCKS_WS_FLAG_ENABLED && stocksEntitled(),
        entitled: stocksEntitled(),
      },
    },
    optionsRest: {
      status: restStatus(),
      lastSuccessAt: lastRestSuccessAt ? new Date(lastRestSuccessAt).toISOString() : null,
      lastErrorAt: lastRestErrorAt ? new Date(lastRestErrorAt).toISOString() : null,
      lastError: lastRestError,
    },
    optionsWebSocket: {
      status: streamStatus(),
      state: wsState as unknown as Record<string, unknown> | null,
      activeSubscriptions: activeSubscriptions.length,
    },
    underlyingData: {
      source: stocksEntitled() ? 'stocks-websocket' : 'options-snapshot-delayed',
      entitlement: stocksEntitled() ? 'realtime-intraday' : 'unauthorized-realtime-intraday',
      lastUpdate: lastUnderlyingUpdateAt ? new Date(lastUnderlyingUpdateAt).toISOString() : null,
    },
    lastOptionUpdateAt: lastOptionUpdate ? new Date(lastOptionUpdate).toISOString() : null,
    streams: {
      quoteStream: componentStatus,
      tradeStream: lastOptionTrade ? componentStatus : activeSubscriptions.length > 0 ? 'WAITING_FOR_QUOTES' : componentStatus,
      aggregateStream: componentStatus,
      quoteCache: cache.freshQuoteCount > 0 ? 'LIVE' : cache.quoteCount > 0 ? 'DEGRADED' : 'WAITING_FOR_QUOTES',
      activeSubscriptions: activeSubscriptions.length,
    },
    components: {
      matrix: componentStatus,
      depth: componentStatus,
      ticket: componentStatus,
      chain: restStatus() === 'OK' ? 'LIVE' : restStatus() === 'DEGRADED' ? 'DEGRADED' : 'OFFLINE',
    },
    caches: {
      snapshotAgeMs: newestChainCacheAgeMs(),
      referenceAgeMs: referenceCacheAgeMs(),
      chainCompleteness: latestCompleteness(),
      quoteCount: cache.quoteCount,
      tradeCount: cache.tradeCount,
      freshQuoteCount: cache.freshQuoteCount,
      staleQuoteCount: cache.staleQuoteCount,
    },
    throttle: {
      entitlementBlocks: getEntitlementBlocks(),
      pendingRequestsByPriority: getPendingRequestsByPriority(),
    },
    reconnect: {
      attempts: wsState?.reconnectAttempts ?? 0,
      nextAttemptAt: wsState?.nextReconnectAt ?? null,
    },
    automationDataReady: readiness.ready,
    automationDataReadyReasons: readiness.reasons,
  };
}
