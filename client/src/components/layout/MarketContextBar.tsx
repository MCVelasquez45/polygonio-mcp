import { memo, useEffect, useState } from 'react';
import { getSharedSocket } from '../../lib/socket';
import { useLiveQuote } from '../../lib/liveMarketStore';
import { LiveNumber } from '../shared/terminal';

// Always-on market context ribbon. A single continuous strip — no boxed tiles —
// where the broad index complex streams through the SAME live:subscribe channel
// the watchlist uses (presentation subscription, not a data-architecture change).
//
// Honesty (freshness contract): real mid prices only, tick-flashed; regime /
// breadth / crypto are omitted until a real feed backs them — a blank truth
// beats a confident guess on a trading desk.

const INDEX_SYMBOLS = ['SPY', 'QQQ', 'IWM', 'DIA'] as const;

const INDEX_LABELS: Record<(typeof INDEX_SYMBOLS)[number], string> = {
  SPY: 'SPY',
  QQQ: 'QQQ',
  IWM: 'IWM',
  DIA: 'DIA',
};

function IndexTicker({ symbol, label }: { symbol: string; label: string }) {
  const quote = useLiveQuote(symbol);
  const mid =
    quote?.midpoint ??
    (quote?.bidPrice != null && quote?.askPrice != null ? (quote.bidPrice + quote.askPrice) / 2 : null);
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="font-mono text-[11px] font-semibold tracking-wide text-intel-ink2">{label}</span>
      <LiveNumber value={mid} className="text-[12px] font-semibold text-intel-ink" />
    </span>
  );
}

export const MarketContextBar = memo(function MarketContextBar() {
  const [streaming, setStreaming] = useState(false);

  useEffect(() => {
    let socket: ReturnType<typeof getSharedSocket> | null = null;
    const onConnect = () => setStreaming(true);
    const onDisconnect = () => setStreaming(false);
    try {
      socket = getSharedSocket();
      setStreaming(Boolean(socket.connected));
      socket.on('connect', onConnect);
      socket.on('disconnect', onDisconnect);
      for (const symbol of INDEX_SYMBOLS) socket.emit('live:subscribe', { symbol });
    } catch {
      /* offline / test env — degrades to OFFLINE honestly */
    }
    return () => {
      try {
        socket?.off('connect', onConnect);
        socket?.off('disconnect', onDisconnect);
        for (const symbol of INDEX_SYMBOLS) socket?.emit('live:unsubscribe', { symbol });
      } catch {
        /* no-op */
      }
    };
  }, []);

  return (
    <div
      className="flex items-center gap-5 overflow-x-auto bg-intel-bg px-4 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="status"
      aria-label="Market context"
    >
      {/* Stream state — the ribbon reads alive or it reads offline, never faked. */}
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            streaming ? 'bg-intel-cyan motion-safe:animate-heartbeat' : 'bg-intel-ink3'
          }`}
        />
        <span className={`font-mono text-[10px] uppercase tracking-label ${streaming ? 'text-intel-cyan' : 'text-intel-ink3'}`}>
          {streaming ? 'STREAM' : 'OFFLINE'}
        </span>
      </span>

      <span className="h-3 w-px shrink-0 bg-intel-divider" />

      {INDEX_SYMBOLS.map(symbol => (
        <IndexTicker key={symbol} symbol={symbol} label={INDEX_LABELS[symbol]} />
      ))}
    </div>
  );
});
