import { useEffect } from 'react';
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

function emitSubscribe(symbol: string) {
  if (subscribed.has(symbol)) return;
  subscribed.add(symbol);
  getSharedSocket().emit('live:subscribe', { symbol });
}

function emitUnsubscribe(symbol: string) {
  if (!subscribed.has(symbol)) return;
  subscribed.delete(symbol);
  getSharedSocket().emit('live:unsubscribe', { symbol });
}

/**
 * Keep a live NBBO/trade subscription for one option symbol alive for the
 * lifetime of the calling component. Re-subscribes after a reconnect. No-op when
 * the symbol is absent (idle cockpit).
 */
export function useCockpitLiveSubscription(symbol: string | null | undefined): void {
  useEffect(() => {
    if (!symbol) return;
    const key = symbol.toUpperCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
    emitSubscribe(key);

    const socket = getSharedSocket();
    // On reconnect the server forgets our subscriptions; re-assert this symbol.
    const resubscribe = () => {
      subscribed.delete(key);
      emitSubscribe(key);
    };
    socket.on('connect', resubscribe);

    return () => {
      socket.off('connect', resubscribe);
      const next = (counts.get(key) ?? 1) - 1;
      if (next <= 0) {
        counts.delete(key);
        emitUnsubscribe(key);
      } else {
        counts.set(key, next);
      }
    };
  }, [symbol]);
}
