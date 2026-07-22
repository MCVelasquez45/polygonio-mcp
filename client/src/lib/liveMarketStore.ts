import { useSyncExternalStore } from 'react';
import type { QuoteSnapshot, TradePrint } from '../types/market';

// External store for high-frequency live market data (quotes + trades).
//
// Socket handlers and the REST fallback publish into this store instead of
// React state on the root component. Panels subscribe to exactly the slice
// they render (one symbol, or the whole map for the options chain), so a
// market tick re-renders only the panels that display that symbol — never
// the entire application tree.

const MAX_TRADE_HISTORY = 200;

type Listener = () => void;

let quotes: Record<string, QuoteSnapshot> = {};
let lastTrades: Record<string, TradePrint> = {};
const tradeHistories = new Map<string, TradePrint[]>();
// Immutable snapshots per symbol so useSyncExternalStore gets stable references.
const historySnapshots = new Map<string, TradePrint[]>();
const EMPTY_HISTORY: TradePrint[] = [];

const symbolListeners = new Map<string, Set<Listener>>();
const mapListeners = new Set<Listener>();

// Wall-clock time the live feed last delivered ANY quote or trade. This is the
// single source of truth for "last successful quote" (health card) and for
// deciding whether the stream is actively flowing vs. merely connected. Read it
// with getLastQuoteAt(); it is intentionally not a reactive hook so the hot tick
// path never forces a render — freshness consumers poll it against a clock.
let lastQuoteAt: number | null = null;

// Options and equities are independent entitlement domains (see
// docs/massive/README.md) — the options feed can be fully live while equities
// are delayed/unauthorized, and neither should be inferred from the other.
// These track each domain's own last-delivery time (+ the equity domain's
// last-seen dataMode) so a workspace-level status bar can report them
// separately instead of collapsing into one "OFFLINE" signal.
let lastOptionQuoteAt: number | null = null;
let lastEquityQuoteAt: number | null = null;
let lastEquityDataMode: QuoteSnapshot['dataMode'] | null = null;

/** Wall-clock ms of the most recent live quote/trade, or null if none yet. */
export function getLastQuoteAt(): number | null {
  return lastQuoteAt;
}

/** Wall-clock ms of the most recent OPTIONS quote/trade, or null if none yet. */
export function getLastOptionQuoteAt(): number | null {
  return lastOptionQuoteAt;
}

/** Wall-clock ms of the most recent EQUITY quote/trade, or null if none yet. */
export function getLastEquityQuoteAt(): number | null {
  return lastEquityQuoteAt;
}

/** dataMode of the most recent equity quote (live/delayed/snapshot), or null if none yet. */
export function getLastEquityDataMode(): QuoteSnapshot['dataMode'] | null {
  return lastEquityDataMode;
}

/** Test/reset seam — clears the last-live-data stamps. */
export function resetLastQuoteAt() {
  lastQuoteAt = null;
  lastOptionQuoteAt = null;
  lastEquityQuoteAt = null;
  lastEquityDataMode = null;
}

function notifySymbol(symbol: string) {
  const listeners = symbolListeners.get(symbol);
  if (listeners) {
    listeners.forEach(listener => listener());
  }
  mapListeners.forEach(listener => listener());
}

function subscribeSymbol(symbol: string | null | undefined, listener: Listener): () => void {
  if (!symbol) return () => undefined;
  const key = symbol.toUpperCase();
  let listeners = symbolListeners.get(key);
  if (!listeners) {
    listeners = new Set();
    symbolListeners.set(key, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners?.delete(listener);
    if (listeners && listeners.size === 0) {
      symbolListeners.delete(key);
    }
  };
}

function subscribeMaps(listener: Listener): () => void {
  mapListeners.add(listener);
  return () => {
    mapListeners.delete(listener);
  };
}

// ---- writers (socket handlers / REST fallback) ----

export function publishQuote(quote: QuoteSnapshot) {
  const symbol = quote.ticker?.toUpperCase();
  if (!symbol) return;
  quotes = { ...quotes, [symbol]: quote };
  const now = Date.now();
  lastQuoteAt = now;
  if (symbol.startsWith('O:')) {
    lastOptionQuoteAt = now;
  } else {
    lastEquityQuoteAt = now;
    lastEquityDataMode = quote.dataMode ?? lastEquityDataMode;
  }
  notifySymbol(symbol);
}

export function publishTrade(trade: TradePrint & { ticker: string }) {
  const symbol = trade.ticker?.toUpperCase();
  if (!symbol) return;
  const now = Date.now();
  lastQuoteAt = now;
  if (symbol.startsWith('O:')) {
    lastOptionQuoteAt = now;
  } else {
    lastEquityQuoteAt = now;
  }
  lastTrades = { ...lastTrades, [symbol]: trade };
  const history = tradeHistories.get(symbol) ?? [];
  if (!(history.length > 0 && history[0]?.id === trade.id)) {
    const next = [trade, ...history].slice(0, MAX_TRADE_HISTORY);
    tradeHistories.set(symbol, next);
    historySnapshots.set(symbol, next);
  }
  notifySymbol(symbol);
}

/** Replace a symbol's trade history wholesale (REST snapshot load). */
export function replaceTradeHistory(symbol: string, trades: TradePrint[]) {
  const key = symbol.toUpperCase();
  const bounded = trades.slice(0, MAX_TRADE_HISTORY);
  tradeHistories.set(key, bounded);
  historySnapshots.set(key, bounded);
  if (bounded[0]) {
    lastTrades = { ...lastTrades, [key]: bounded[0] };
  }
  notifySymbol(key);
}

/** Drop cached data for symbols we no longer subscribe to on the live feed. */
export function removeSymbols(symbols: Iterable<string>) {
  let changed = false;
  const nextQuotes = { ...quotes };
  const nextTrades = { ...lastTrades };
  for (const raw of symbols) {
    const symbol = raw.toUpperCase();
    if (symbol in nextQuotes) {
      delete nextQuotes[symbol];
      changed = true;
    }
    if (symbol in nextTrades) {
      delete nextTrades[symbol];
      changed = true;
    }
    tradeHistories.delete(symbol);
    historySnapshots.delete(symbol);
  }
  if (changed) {
    quotes = nextQuotes;
    lastTrades = nextTrades;
    mapListeners.forEach(listener => listener());
  }
}

// ---- readers (panel hooks) ----

/** Latest live quote for one symbol; re-renders only on that symbol's ticks. */
export function useLiveQuote(symbol: string | null | undefined): QuoteSnapshot | null {
  const key = symbol?.toUpperCase() ?? null;
  return useSyncExternalStore(
    listener => subscribeSymbol(key, listener),
    () => (key ? quotes[key] ?? null : null)
  );
}

/** Latest live trade print for one symbol. */
export function useLiveTrade(symbol: string | null | undefined): TradePrint | null {
  const key = symbol?.toUpperCase() ?? null;
  return useSyncExternalStore(
    listener => subscribeSymbol(key, listener),
    () => (key ? lastTrades[key] ?? null : null)
  );
}

/** Bounded trade history for one symbol (live pushes + REST snapshots). */
export function useLiveTradeHistory(symbol: string | null | undefined): TradePrint[] {
  const key = symbol?.toUpperCase() ?? null;
  return useSyncExternalStore(
    listener => subscribeSymbol(key, listener),
    () => (key ? historySnapshots.get(key) ?? EMPTY_HISTORY : EMPTY_HISTORY)
  );
}

/** Full quote map — for the options chain strip. Re-renders on any tick. */
export function useLiveQuotes(): Record<string, QuoteSnapshot> {
  return useSyncExternalStore(subscribeMaps, () => quotes);
}

/** Full last-trade map — for the options chain strip. */
export function useLiveTrades(): Record<string, TradePrint> {
  return useSyncExternalStore(subscribeMaps, () => lastTrades);
}

/** Non-reactive latest quote read, for request-time payload enrichment. */
export function getLiveQuoteSnapshot(symbol: string | null | undefined): QuoteSnapshot | null {
  const key = symbol?.toUpperCase();
  return key ? quotes[key] ?? null : null;
}

/** Non-reactive latest trade read, for request-time payload enrichment. */
export function getLiveTradeSnapshot(symbol: string | null | undefined): TradePrint | null {
  const key = symbol?.toUpperCase();
  return key ? lastTrades[key] ?? null : null;
}
