import {
  getEntitlementBlocks,
  getPendingRequestsByPriority,
} from '../../shared/data/massive';
import {
  getActiveOptionSubscriptions,
  getOptionsWsState,
  isOptionsStreamHealthy,
} from './optionsSubscriptionManager.service';
import { newestChainCacheAgeMs, latestCompleteness } from './optionsChainCache.service';
import { referenceCacheAgeMs } from './optionsContractCache.service';
import { getLastOptionUpdateAt } from './optionsQuoteCache.service';
import type { MarketDataHealthReport, OptionsRestStatus, OptionsStreamStatus } from './optionsData.types';

// Health registry for the options market-data pipeline. This is the single
// place that answers "is the data good enough for automation?" — and it
// answers NO whenever the required authoritative data is unavailable.

export const SUBSCRIPTION_PROFILE = (process.env.MASSIVE_SUBSCRIPTION_PROFILE ?? 'options-advanced')
  .trim()
  .toLowerCase();

/** Whether the configured plan includes real-time stock market data. */
export function stocksEntitled(): boolean {
  return SUBSCRIPTION_PROFILE !== 'options-advanced';
}

const CAPABILITY_VERIFICATION = {
  method: 'massive-mcp + controlled REST probes (see docs/market-data/options-advanced-alignment-audit.md §7)',
  verifiedAt: '2026-07-13',
  notes:
    'Options REST/WS real-time confirmed. Underlying block in options snapshots is DELAYED. ' +
    'Current-day stock intraday aggregates return NOT_AUTHORIZED under this plan; the MCP exposes no entitlement API.',
};

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
  const state = getOptionsWsState();
  if (!state) return 'DISABLED'; // no connection requested yet
  if (isOptionsStreamHealthy()) return 'CONNECTED';
  return state.reconnectAttempts > 3 ? 'UNAVAILABLE' : 'DEGRADED';
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
  const wsState = getOptionsWsState();
  const readiness = automationDataReadiness();
  const lastOptionUpdate = getLastOptionUpdateAt();
  return {
    timestamp: new Date().toISOString(),
    subscriptionProfile: SUBSCRIPTION_PROFILE,
    capabilityVerification: CAPABILITY_VERIFICATION,
    optionsRest: {
      status: restStatus(),
      lastSuccessAt: lastRestSuccessAt ? new Date(lastRestSuccessAt).toISOString() : null,
      lastErrorAt: lastRestErrorAt ? new Date(lastRestErrorAt).toISOString() : null,
      lastError: lastRestError,
    },
    optionsWebSocket: {
      status: streamStatus(),
      state: wsState as unknown as Record<string, unknown> | null,
      activeSubscriptions: getActiveOptionSubscriptions().length,
    },
    underlyingData: {
      source: 'options-snapshot-delayed',
      entitlement: stocksEntitled() ? 'delayed-only' : 'unauthorized-realtime-intraday',
      lastUpdate: lastUnderlyingUpdateAt ? new Date(lastUnderlyingUpdateAt).toISOString() : null,
    },
    lastOptionUpdateAt: lastOptionUpdate ? new Date(lastOptionUpdate).toISOString() : null,
    caches: {
      snapshotAgeMs: newestChainCacheAgeMs(),
      referenceAgeMs: referenceCacheAgeMs(),
      chainCompleteness: latestCompleteness(),
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
