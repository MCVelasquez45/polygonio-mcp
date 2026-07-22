import { memo } from 'react';
import { useLiveQuote } from '../../lib/liveMarketStore';
import { useLiveMarketSubscriptions } from '../../hooks/useCockpitLiveSubscription';
import { LiveNumber } from '../shared/terminal';

// Always-on market context ribbon. A single continuous strip — no boxed tiles —
// where the broad index complex streams through the SAME live:subscribe channel
// the watchlist uses (presentation subscription, not a data-architecture change).
//
// Honesty (freshness contract): real mid prices only, tick-flashed; regime /
// breadth / crypto are omitted until a real feed backs them — a blank truth
// beats a confident guess on a trading desk.
//
// Socket/backend/feed connectivity used to live here as a single "STREAM /
// OFFLINE" indicator, which conflated Socket.IO connectivity with unrelated
// subsystems. That's now SystemStatusBar, with one independent state per
// domain — this component is index prices only.

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
  useLiveMarketSubscriptions([...INDEX_SYMBOLS]);

  return (
    <div
      className="flex items-center gap-5 overflow-x-auto bg-intel-bg px-4 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="status"
      aria-label="Market context"
    >
      {INDEX_SYMBOLS.map(symbol => (
        <IndexTicker key={symbol} symbol={symbol} label={INDEX_LABELS[symbol]} />
      ))}
    </div>
  );
});
