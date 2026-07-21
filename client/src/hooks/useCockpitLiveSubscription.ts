import { useEffect, useMemo } from 'react';
import { getSharedSocket } from '../lib/socket';

// Client-side reference counting for the shared live feed.
//
// The whole app shares ONE socket. If the cockpit and (later) another panel both
// want the same option symbol, naive subscribe/unsubscribe would let one unmount
// tear down a feed the other still needs — the server tracks membership as a Set
// per socket, not a count. So we count here: emit `live:subscribe` only on the
// first consumer of a symbol and `live:unsubscribe` only when the last one leaves.

const counts = new Map<string, number>();
const subscribed = new Set<string>();
let reconnectHandlerInstalled = false;

function emitSubscribe(symbol: string) {
  if (subscribed.has(symbol)) return;
  subscribed.add(symbol);
  console.info('[LiveFeed] CLIENT_SUBSCRIBE', { symbol });
  getSharedSocket().emit('live:subscribe', { symbol });
}

function emitUnsubscribe(symbol: string) {
  if (!subscribed.has(symbol)) return;
  subscribed.delete(symbol);
  getSharedSocket().emit('live:unsubscribe', { symbol });
}

function ensureReconnectHandler() {
  if (reconnectHandlerInstalled) return;
  reconnectHandlerInstalled = true;
  getSharedSocket().on('connect', () => {
    const symbols = Array.from(subscribed);
    subscribed.clear();
    symbols.forEach(emitSubscribe);
  });
}

export function acquireLiveMarketSubscription(symbol: string | null | undefined): (() => void) | null {
  if (!symbol) return null;
  const key = symbol.toUpperCase();
  ensureReconnectHandler();
  counts.set(key, (counts.get(key) ?? 0) + 1);
  emitSubscribe(key);
  return () => {
    const next = (counts.get(key) ?? 1) - 1;
    if (next <= 0) {
      counts.delete(key);
      emitUnsubscribe(key);
    } else {
      counts.set(key, next);
    }
  };
}

/**
 * Keep a live NBBO/trade subscription for one option symbol alive for the
 * lifetime of the calling component. Re-subscribes after a reconnect. No-op when
 * the symbol is absent (idle cockpit).
 */
export function useCockpitLiveSubscription(symbol: string | null | undefined): void {
  useLiveMarketSubscription(symbol);
}

/** Keep one market symbol subscribed on the shared live feed. */
export function useLiveMarketSubscription(symbol: string | null | undefined): void {
  useEffect(() => {
    return acquireLiveMarketSubscription(symbol) ?? undefined;
  }, [symbol]);
}

/** Keep a de-duped set of market symbols subscribed on the shared live feed. */
export function useLiveMarketSubscriptions(symbols: Array<string | null | undefined>): void {
  const key = useMemo(
    () =>
      Array.from(
        new Set(
          symbols
            .map(symbol => symbol?.trim().toUpperCase())
            .filter((symbol): symbol is string => Boolean(symbol))
        )
      ).join(','),
    [symbols]
  );

  useEffect(() => {
    const releases = key
      .split(',')
      .filter(Boolean)
      .map(symbol => acquireLiveMarketSubscription(symbol))
      .filter((release): release is () => void => Boolean(release));
    return () => {
      releases.forEach(release => release());
    };
  }, [key]);
}
