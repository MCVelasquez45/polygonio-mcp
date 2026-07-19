import { normalizeProviderTimestamp } from '../../shared/data/massive';

// Per-contract latest-quote cache. WebSocket `Q` events are the preferred
// source; REST snapshots hydrate it initially and after reconnects. Every
// entry keeps the PROVIDER timestamp so staleness gates use market truth,
// not the time we happened to receive the message.

export type CachedOptionQuote = {
  symbol: string;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  bidSize: number | null;
  askSize: number | null;
  /** Provider (SIP) timestamp, epoch ms. */
  providerTimestamp: number | null;
  receivedAt: number;
  source: 'websocket' | 'rest';
};

const quotes = new Map<string, CachedOptionQuote>();
let lastOptionUpdateAt: number | null = null;

/** Ingest a WebSocket `Q` event ({sym, bp, ap, bs, as, t}). */
export function ingestWsQuote(event: any): void {
  const symbol = typeof event?.sym === 'string' ? event.sym.toUpperCase() : null;
  if (!symbol) return;
  const bid = typeof event.bp === 'number' ? event.bp : null;
  const ask = typeof event.ap === 'number' ? event.ap : null;
  const entry: CachedOptionQuote = {
    symbol,
    bid,
    ask,
    mid: bid != null && ask != null ? (bid + ask) / 2 : bid ?? ask ?? null,
    bidSize: typeof event.bs === 'number' ? event.bs : null,
    askSize: typeof event.as === 'number' ? event.as : null,
    providerTimestamp: normalizeProviderTimestamp(event.t),
    receivedAt: Date.now(),
    source: 'websocket',
  };
  quotes.set(symbol, entry);
  lastOptionUpdateAt = entry.receivedAt;
}

/** Hydrate from a REST quote/snapshot (initial load or reconnect recovery). */
export function ingestRestQuote(args: {
  symbol: string;
  bid: number | null;
  ask: number | null;
  bidSize?: number | null;
  askSize?: number | null;
  providerTimestamp: number | null;
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
  const entry: CachedOptionQuote = {
    symbol,
    bid: args.bid,
    ask: args.ask,
    mid: args.bid != null && args.ask != null ? (args.bid + args.ask) / 2 : args.bid ?? args.ask ?? null,
    bidSize: args.bidSize ?? null,
    askSize: args.askSize ?? null,
    providerTimestamp: args.providerTimestamp,
    receivedAt: Date.now(),
    source: 'rest',
  };
  quotes.set(symbol, entry);
  lastOptionUpdateAt = entry.receivedAt;
}

export function getCachedQuote(symbol: string): CachedOptionQuote | null {
  return quotes.get(symbol.toUpperCase()) ?? null;
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

export function clearQuoteCache(): void {
  quotes.clear();
  lastOptionUpdateAt = null;
}
