import { MassiveWsClient, type MassiveWsState } from '../../shared/data/massiveWs';
import { ingestWsQuote, ingestWsTrade } from './optionsQuoteCache.service';

// Single owner of the Massive OPTIONS WebSocket connection and its
// subscriptions. Consumers (live feed sockets, automation, scanner focus)
// acquire/release interest in a contract; the manager dedupes, refcounts,
// enforces the documented 1,000-contracts-per-connection cap, and unsubscribes
// when the last consumer releases. The stock WebSocket is NOT owned here —
// Options Advanced has no stocks stream entitlement (see liveFeed profile gate).

const DEFAULT_OPTIONS_WS_URL = 'wss://socket.massive.com/options';
const MASSIVE_WS_URL_OPTIONS = process.env.MASSIVE_OPTIONS_WS_URL ?? DEFAULT_OPTIONS_WS_URL;
const MASSIVE_WS_KEY = process.env.MASSIVE_API_KEY ?? '';
const NODE_ENV = process.env.NODE_ENV ?? 'development';
const OPTIONS_WS_ENABLED_RAW = process.env.MASSIVE_OPTIONS_WS_ENABLED;
const OPTIONS_WS_REQUESTED =
  OPTIONS_WS_ENABLED_RAW == null || OPTIONS_WS_ENABLED_RAW === ''
    ? true
    : OPTIONS_WS_ENABLED_RAW.toLowerCase() === 'true';
const ALLOW_NON_PROD_OWNER = (process.env.MASSIVE_OPTIONS_ALLOW_NON_PROD_OWNER ?? 'false').toLowerCase() === 'true';
const IS_PRODUCTION = NODE_ENV === 'production';
const OPTIONS_WS_ENABLED = OPTIONS_WS_REQUESTED && (IS_PRODUCTION || ALLOW_NON_PROD_OWNER);
const OPTIONS_DATA_MODE: 'live' | 'delayed' = MASSIVE_WS_URL_OPTIONS.includes('delayed.massive.com') ? 'delayed' : 'live';

if (IS_PRODUCTION && MASSIVE_WS_URL_OPTIONS.includes('delayed.massive.com')) {
  throw new Error('Production is configured with the delayed Massive options WebSocket endpoint.');
}

if (!OPTIONS_WS_ENABLED && OPTIONS_WS_REQUESTED) {
  console.warn('[OptionsWS] live options WebSocket disabled for this non-production process', {
    nodeEnv: NODE_ENV,
    endpoint: MASSIVE_WS_URL_OPTIONS,
    hint: 'set MASSIVE_OPTIONS_ALLOW_NON_PROD_OWNER=true only for the designated local owner',
  });
}

console.log('[OptionsWS] configuration', {
  enabled: OPTIONS_WS_ENABLED,
  endpoint: MASSIVE_WS_URL_OPTIONS,
  dataMode: OPTIONS_DATA_MODE,
  nodeEnv: NODE_ENV,
});
/** Documented Massive limit for options quote subscriptions per connection. */
const MAX_CONTRACTS_PER_CONNECTION = Math.max(
  1,
  Number(process.env.MASSIVE_OPTIONS_WS_MAX_CONTRACTS ?? 1_000)
);

const TRADE_QUOTE_CHANNELS = (process.env.MASSIVE_OPTIONS_WS_CHANNELS ?? 'T,Q')
  .split(',')
  .map(entry => entry.trim().toUpperCase())
  .filter(entry => ['T', 'Q'].includes(entry));
const AGG_CHANNELS = (process.env.MASSIVE_OPTIONS_WS_AGG_CHANNELS ?? 'AM,A')
  .split(',')
  .map(entry => entry.trim().toUpperCase())
  .filter(entry => ['AM', 'A'].includes(entry));

export type OptionsSubscriptionKind = 'trades_quotes' | 'aggs';

export type OptionsSubscriptionResult = {
  accepted: boolean;
  reason: string | null;
  providerStatus: string | null;
  providerMessage: string | null;
  payload: string | null;
};

type SubscriptionRecord = {
  // consumer ids per kind so the same contract can be held by the UI and
  // automation independently.
  consumers: Map<OptionsSubscriptionKind, Set<string>>;
};

const records = new Map<string, SubscriptionRecord>();
const messageListeners = new Set<(event: any) => void>();
const statusListeners = new Set<(event: any) => void>();
let wsClient: MassiveWsClient | null = null;
let lastMessageAt: number | null = null;

function channelsFor(kind: OptionsSubscriptionKind): string[] {
  return kind === 'aggs'
    ? (AGG_CHANNELS.length ? AGG_CHANNELS : ['AM', 'A'])
    : (TRADE_QUOTE_CHANNELS.length ? TRADE_QUOTE_CHANNELS : ['T', 'Q']);
}

function subscriptionParams(symbol: string, kind: OptionsSubscriptionKind): string {
  return channelsFor(kind).map(channel => `${channel}.${symbol}`).join(',');
}

function failure(reason: string, payload: string | null = null): OptionsSubscriptionResult {
  const state = wsClient?.getState();
  return {
    accepted: false,
    reason,
    providerStatus: state?.lastStatus ?? null,
    providerMessage: state?.lastStatusMessage ?? null,
    payload,
  };
}

function handleMessage(event: any) {
  lastMessageAt = Date.now();
  const enriched =
    event && typeof event === 'object'
      ? {
          ...event,
          source: OPTIONS_DATA_MODE === 'delayed' ? 'delayed-websocket' : 'websocket',
          dataMode: OPTIONS_DATA_MODE,
        }
      : event;
  if (event?.ev === 'Q') {
    ingestWsQuote(enriched, OPTIONS_DATA_MODE);
  } else if (event?.ev === 'T') {
    ingestWsTrade(enriched, OPTIONS_DATA_MODE);
  }
  for (const listener of messageListeners) {
    try {
      listener(enriched);
    } catch (error) {
      console.error('[OptionsWS] listener failed', { error: (error as Error)?.message });
    }
  }
}

function handleStatus(event: any) {
  for (const listener of statusListeners) {
    try {
      listener(event);
    } catch (error) {
      console.error('[OptionsWS] status listener failed', { error: (error as Error)?.message });
    }
  }
}

function ensureClient(): MassiveWsClient | null {
  if (!OPTIONS_WS_ENABLED) return null;
  if (!MASSIVE_WS_KEY) return null;
  if (!wsClient) {
    wsClient = new MassiveWsClient({
      url: MASSIVE_WS_URL_OPTIONS,
      apiKey: MASSIVE_WS_KEY,
      assetClass: 'options',
      onMessage: handleMessage,
      onStatus: handleStatus,
      onConnect: () => console.log('[OptionsWS] connected + authenticated'),
      onError: err => console.error('[OptionsWS] error', (err as Error)?.message ?? err),
    });
    wsClient.connect();
  }
  return wsClient;
}

/** Register a raw-event listener (e.g. the socket.io live feed broadcaster). */
export function addOptionsWsListener(listener: (event: any) => void): void {
  messageListeners.add(listener);
}

export function addOptionsWsStatusListener(listener: (event: any) => void): void {
  statusListeners.add(listener);
}

export function isOptionContractSymbol(symbol: string): boolean {
  return symbol.toUpperCase().startsWith('O:');
}

/**
 * Acquire live data for a contract. Returns false when the request was
 * refused (not an option symbol, no API key, or the per-connection cap).
 */
export function acquireOptionSubscription(
  rawSymbol: string,
  kind: OptionsSubscriptionKind,
  consumerId: string
): OptionsSubscriptionResult {
  const symbol = rawSymbol.trim().toUpperCase();
  const params = subscriptionParams(symbol, kind);
  if (!isOptionContractSymbol(symbol)) return failure('invalid_option_symbol', params);
  const client = ensureClient();
  if (!client) {
    if (!MASSIVE_WS_KEY) return failure('missing_massive_api_key', params);
    if (!OPTIONS_WS_ENABLED) return failure('options_ws_not_designated_owner', params);
    return failure('options_ws_unavailable', params);
  }

  let record = records.get(symbol);
  const isNewContract = !record;
  if (isNewContract && records.size >= MAX_CONTRACTS_PER_CONNECTION) {
    console.warn('[OptionsWS] subscription cap reached, refusing new contract', {
      symbol,
      cap: MAX_CONTRACTS_PER_CONNECTION,
    });
    return failure('options_contract_limit_reached', params);
  }
  if (!record) {
    record = { consumers: new Map() };
    records.set(symbol, record);
  }
  const kindConsumers = record.consumers.get(kind) ?? new Set<string>();
  const isNewKind = kindConsumers.size === 0;
  kindConsumers.add(consumerId);
  record.consumers.set(kind, kindConsumers);

  if (isNewKind) {
    console.log('[OptionsWS] PROVIDER_SUBSCRIBE', {
      symbol,
      kind,
      payload: { action: 'subscribe', params },
      authenticated: client.getState().authenticated,
      connected: client.getState().connected,
    });
    client.subscribe(params);
  }
  return {
    accepted: true,
    reason: null,
    providerStatus: client.getState().lastStatus,
    providerMessage: client.getState().lastStatusMessage,
    payload: params,
  };
}

/** Release a consumer's interest; unsubscribes when nobody needs the contract. */
export function releaseOptionSubscription(
  rawSymbol: string,
  kind: OptionsSubscriptionKind,
  consumerId: string
): void {
  const symbol = rawSymbol.trim().toUpperCase();
  const record = records.get(symbol);
  if (!record) return;
  const kindConsumers = record.consumers.get(kind);
  if (!kindConsumers) return;
  kindConsumers.delete(consumerId);
  if (kindConsumers.size === 0) {
    record.consumers.delete(kind);
    wsClient?.unsubscribe(subscriptionParams(symbol, kind));
  }
  if (record.consumers.size === 0) {
    records.delete(symbol);
  }
}

export function getOptionsWsState(): (MassiveWsState & { lastMessageAt: string | null }) | null {
  if (!wsClient) return null;
  return { ...wsClient.getState(), lastMessageAt: lastMessageAt ? new Date(lastMessageAt).toISOString() : null };
}

export function getOptionsWsConfig(): {
  enabled: boolean;
  endpoint: string;
  dataMode: 'live' | 'delayed';
  nodeEnv: string;
  allowNonProdOwner: boolean;
} {
  return {
    enabled: OPTIONS_WS_ENABLED,
    endpoint: MASSIVE_WS_URL_OPTIONS,
    dataMode: OPTIONS_DATA_MODE,
    nodeEnv: NODE_ENV,
    allowNonProdOwner: ALLOW_NON_PROD_OWNER,
  };
}

export function getActiveOptionSubscriptions(): Array<{ symbol: string; kinds: string[]; consumers: number }> {
  return Array.from(records.entries()).map(([symbol, record]) => ({
    symbol,
    kinds: Array.from(record.consumers.keys()),
    consumers: Array.from(record.consumers.values()).reduce((acc, set) => acc + set.size, 0),
  }));
}

/** True when the options stream is authenticated and receiving. */
export function isOptionsStreamHealthy(maxSilenceMs = 5 * 60_000): boolean {
  const state = wsClient?.getState();
  if (!state?.connected || !state.authenticated) return false;
  if (records.size > 0 && lastMessageAt != null && Date.now() - lastMessageAt > maxSilenceMs) return false;
  return true;
}

/** Test hook. */
export function resetOptionsSubscriptionsForTest(): void {
  records.clear();
  messageListeners.clear();
  statusListeners.clear();
  wsClient?.disconnect();
  wsClient = null;
  lastMessageAt = null;
}

export function shutdownOptionsStream(): void {
  wsClient?.disconnect();
  wsClient = null;
  lastMessageAt = null;
}
