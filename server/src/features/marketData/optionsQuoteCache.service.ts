import { normalizeProviderTimestamp } from '../../shared/data/massive';

// Per-contract latest-quote cache. WebSocket `Q` events are the preferred
// source; REST snapshots hydrate it initially and after reconnects. Every
// entry keeps the PROVIDER timestamp so staleness gates use market truth,
// not the time we happened to receive the message.

export type CachedOptionQuote = {
  symbol: string;
  underlying: string | null;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  mark: number | null;
  spread: number | null;
  bidSize: number | null;
  askSize: number | null;
  last: number | null;
  lastSize: number | null;
  lastTradeTimestamp: number | null;
  sequenceNumber: number | null;
  timestamp: number | null;
  /** Provider (SIP) timestamp, epoch ms. */
  providerTimestamp: number | null;
  receivedAt: number;
  source: 'websocket' | 'rest-snapshot' | 'delayed-websocket';
  dataMode: 'live' | 'delayed' | 'snapshot';
};

export type CachedOptionTrade = {
  symbol: string;
  underlying: string | null;
  price: number | null;
  size: number | null;
  providerTimestamp: number | null;
  receivedAt: number;
  sequenceNumber: number | null;
  id: string;
  exchange: number | string | null;
  conditions: Array<number | string> | null;
  source: 'websocket' | 'rest-snapshot' | 'delayed-websocket';
  dataMode: 'live' | 'delayed' | 'snapshot';
};

type QuoteCacheListener = (quote: CachedOptionQuote) => void;
type TradeCacheListener = (trade: CachedOptionTrade) => void;

const quotes = new Map<string, CachedOptionQuote>();
const trades = new Map<string, CachedOptionTrade>();
const quoteListeners = new Set<QuoteCacheListener>();
const tradeListeners = new Set<TradeCacheListener>();
let lastOptionUpdateAt: number | null = null;
let lastOptionTradeAt: number | null = null;

function notifyQuote(entry: CachedOptionQuote): void {
  for (const listener of quoteListeners) {
    try {
      listener(entry);
    } catch (error) {
      console.error('[OptionsQuoteCache] listener failed', { error: (error as Error)?.message });
    }
  }
}

function notifyTrade(entry: CachedOptionTrade): void {
  for (const listener of tradeListeners) {
    try {
      listener(entry);
    } catch (error) {
      console.error('[OptionsTradeCache] listener failed', { error: (error as Error)?.message });
    }
  }
}

function underlyingFromOptionSymbol(symbol: string): string | null {
  const match = symbol.match(/^O:([A-Z0-9.]+)\d{6}[CP]/);
  return match?.[1] ?? null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sequenceOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Ingest a WebSocket `Q` event ({sym, bp, ap, bs, as, t}). */
export function ingestWsQuote(event: any, dataMode: 'live' | 'delayed' = 'live'): void {
  const symbol = typeof event?.sym === 'string' ? event.sym.toUpperCase() : null;
  if (!symbol) return;
  const existing = quotes.get(symbol);
  const bid = numberOrNull(event.bp);
  const ask = numberOrNull(event.ap);
  const spread = bid != null && ask != null ? Math.max(0, ask - bid) : null;
  const mid = bid != null && ask != null ? (bid + ask) / 2 : bid ?? ask ?? null;
  const providerTimestamp = normalizeProviderTimestamp(event.t);
  const entry: CachedOptionQuote = {
    symbol,
    underlying: underlyingFromOptionSymbol(symbol),
    bid,
    ask,
    mid,
    mark: mid ?? existing?.last ?? null,
    spread,
    bidSize: numberOrNull(event.bs),
    askSize: numberOrNull(event.as),
    last: existing?.last ?? null,
    lastSize: existing?.lastSize ?? null,
    lastTradeTimestamp: existing?.lastTradeTimestamp ?? null,
    sequenceNumber: sequenceOrNull(event.q),
    timestamp: providerTimestamp,
    providerTimestamp,
    receivedAt: Date.now(),
    source: dataMode === 'delayed' ? 'delayed-websocket' : 'websocket',
    dataMode,
  };
  quotes.set(symbol, entry);
  lastOptionUpdateAt = entry.receivedAt;
  notifyQuote(entry);
}

/** Ingest a WebSocket `T` event ({sym, p, s, t, q}). */
export function ingestWsTrade(event: any, dataMode: 'live' | 'delayed' = 'live'): CachedOptionTrade | null {
  const symbol = typeof event?.sym === 'string' ? event.sym.toUpperCase() : null;
  if (!symbol) return null;
  const providerTimestamp = normalizeProviderTimestamp(event.t);
  const price = numberOrNull(event.p);
  const size = numberOrNull(event.s);
  const sequenceNumber = sequenceOrNull(event.q);
  const id = String(event.i ?? event.id ?? `${symbol}-${providerTimestamp ?? Date.now()}-${sequenceNumber ?? 'na'}-${price ?? 'na'}-${size ?? 'na'}`);
  const entry: CachedOptionTrade = {
    symbol,
    underlying: underlyingFromOptionSymbol(symbol),
    price,
    size,
    providerTimestamp,
    receivedAt: Date.now(),
    sequenceNumber,
    id,
    exchange: event.x ?? null,
    conditions: Array.isArray(event.c) ? event.c : null,
    source: dataMode === 'delayed' ? 'delayed-websocket' : 'websocket',
    dataMode,
  };
  trades.set(symbol, entry);
  lastOptionTradeAt = entry.receivedAt;
  lastOptionUpdateAt = entry.receivedAt;

  const existing = quotes.get(symbol);
  if (existing) {
    const updated: CachedOptionQuote = {
      ...existing,
      last: price,
      lastSize: size,
      lastTradeTimestamp: providerTimestamp,
      mark: existing.mid ?? price ?? existing.mark,
      receivedAt: entry.receivedAt,
      source: entry.source,
      dataMode: entry.dataMode,
    };
    quotes.set(symbol, updated);
    notifyQuote(updated);
  }

  notifyTrade(entry);
  return entry;
}

/** Hydrate from a REST quote/snapshot (initial load or reconnect recovery). */
export function ingestRestQuote(args: {
  symbol: string;
  bid: number | null;
  ask: number | null;
  bidSize?: number | null;
  askSize?: number | null;
  providerTimestamp: number | null;
  last?: number | null;
  lastSize?: number | null;
  lastTradeTimestamp?: number | null;
  sequenceNumber?: number | null;
}): void {
  const symbol = args.symbol.toUpperCase();
  const existing = quotes.get(symbol);
  // Never let an older REST quote clobber a newer WS quote.
  if (
    existing &&
    existing.providerTimestamp != null &&
    args.providerTimestamp != null &&
    args.providerTimestamp <= existing.providerTimestamp
  ) {
    return;
  }
  const spread = args.bid != null && args.ask != null ? Math.max(0, args.ask - args.bid) : null;
  const entry: CachedOptionQuote = {
    symbol,
    underlying: underlyingFromOptionSymbol(symbol),
    bid: args.bid,
    ask: args.ask,
    mid: args.bid != null && args.ask != null ? (args.bid + args.ask) / 2 : args.bid ?? args.ask ?? null,
    mark: args.bid != null && args.ask != null ? (args.bid + args.ask) / 2 : args.last ?? args.bid ?? args.ask ?? null,
    spread,
    bidSize: args.bidSize ?? null,
    askSize: args.askSize ?? null,
    last: args.last ?? existing?.last ?? null,
    lastSize: args.lastSize ?? existing?.lastSize ?? null,
    lastTradeTimestamp: args.lastTradeTimestamp ?? existing?.lastTradeTimestamp ?? null,
    sequenceNumber: args.sequenceNumber ?? existing?.sequenceNumber ?? null,
    timestamp: args.providerTimestamp,
    providerTimestamp: args.providerTimestamp,
    receivedAt: Date.now(),
    source: 'rest-snapshot',
    dataMode: 'snapshot',
  };
  quotes.set(symbol, entry);
  lastOptionUpdateAt = entry.receivedAt;
  notifyQuote(entry);
}

export function getCachedQuote(symbol: string): CachedOptionQuote | null {
  return quotes.get(symbol.toUpperCase()) ?? null;
}

export function getCachedTrade(symbol: string): CachedOptionTrade | null {
  return trades.get(symbol.toUpperCase()) ?? null;
}

/** Quotes older than maxAgeMs (by provider timestamp) are rejected as stale. */
export function getFreshQuote(symbol: string, maxAgeMs: number, now = Date.now()): CachedOptionQuote | null {
  const quote = getCachedQuote(symbol);
  if (!quote) return null;
  const ts = quote.providerTimestamp ?? quote.receivedAt;
  if (now - ts > maxAgeMs) return null;
  return quote;
}

export function getLastOptionUpdateAt(): number | null {
  return lastOptionUpdateAt;
}

export function getLastOptionTradeAt(): number | null {
  return lastOptionTradeAt;
}

export function quoteCacheStats(maxAgeMs: number, now = Date.now()): {
  quoteCount: number;
  freshQuoteCount: number;
  staleQuoteCount: number;
  tradeCount: number;
} {
  let freshQuoteCount = 0;
  let staleQuoteCount = 0;
  for (const quote of quotes.values()) {
    const ts = quote.providerTimestamp ?? quote.receivedAt;
    if (now - ts <= maxAgeMs) freshQuoteCount += 1;
    else staleQuoteCount += 1;
  }
  return { quoteCount: quotes.size, freshQuoteCount, staleQuoteCount, tradeCount: trades.size };
}

export function clearQuoteCache(): void {
  quotes.clear();
  trades.clear();
  lastOptionUpdateAt = null;
  lastOptionTradeAt = null;
}

export function addRestQuoteCacheListener(listener: QuoteCacheListener): () => void {
  quoteListeners.add(listener);
  return () => {
    quoteListeners.delete(listener);
  };
}

export function addTradeCacheListener(listener: TradeCacheListener): () => void {
  tradeListeners.add(listener);
  return () => {
    tradeListeners.delete(listener);
  };
}

export function resetQuoteCacheListenersForTest(): void {
  quoteListeners.clear();
  tradeListeners.clear();
}
