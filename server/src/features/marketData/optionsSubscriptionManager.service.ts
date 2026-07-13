import { MassiveWsClient, type MassiveWsState } from '../../shared/data/massiveWs';
import { ingestWsQuote } from './optionsQuoteCache.service';

// Single owner of the Massive OPTIONS WebSocket connection and its
// subscriptions. Consumers (live feed sockets, automation, scanner focus)
// acquire/release interest in a contract; the manager dedupes, refcounts,
// enforces the documented 1,000-contracts-per-connection cap, and unsubscribes
// when the last consumer releases. The stock WebSocket is NOT owned here —
// Options Advanced has no stocks stream entitlement (see liveFeed profile gate).

const MASSIVE_WS_URL_OPTIONS = process.env.MASSIVE_OPTIONS_WS_URL ?? 'wss://socket.massive.com/options';
const MASSIVE_WS_KEY = process.env.MASSIVE_API_KEY ?? '';
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

type SubscriptionRecord = {
  // consumer ids per kind so the same contract can be held by the UI and
  // automation independently.
  consumers: Map<OptionsSubscriptionKind, Set<string>>;
};

const records = new Map<string, SubscriptionRecord>();
const messageListeners = new Set<(event: any) => void>();
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

function handleMessage(event: any) {
  lastMessageAt = Date.now();
  if (event?.ev === 'Q') {
    ingestWsQuote(event);
  }
  for (const listener of messageListeners) {
    try {
      listener(event);
    } catch (error) {
      console.error('[OptionsWS] listener failed', { error: (error as Error)?.message });
    }
  }
}

function ensureClient(): MassiveWsClient | null {
  if (!MASSIVE_WS_KEY) return null;
  if (!wsClient) {
    wsClient = new MassiveWsClient({
      url: MASSIVE_WS_URL_OPTIONS,
      apiKey: MASSIVE_WS_KEY,
      assetClass: 'options',
      onMessage: handleMessage,
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
): boolean {
  const symbol = rawSymbol.trim().toUpperCase();
  if (!isOptionContractSymbol(symbol)) return false;
  const client = ensureClient();
  if (!client) return false;

  let record = records.get(symbol);
  const isNewContract = !record;
  if (isNewContract && records.size >= MAX_CONTRACTS_PER_CONNECTION) {
    console.warn('[OptionsWS] subscription cap reached, refusing new contract', {
      symbol,
      cap: MAX_CONTRACTS_PER_CONNECTION,
    });
    return false;
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
    client.subscribe(subscriptionParams(symbol, kind));
  }
  return true;
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
  wsClient?.disconnect();
  wsClient = null;
  lastMessageAt = null;
}
