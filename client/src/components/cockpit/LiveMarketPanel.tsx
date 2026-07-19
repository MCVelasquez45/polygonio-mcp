import { useLiveTrade, useLiveTradeHistory } from '../../lib/liveMarketStore';
import { finiteOrNull } from '../../lib/marketFormat';
import { marketDataStatusLabel, type MarketDataStatus } from '../../lib/marketDataStatus';
import { Panel, Badge } from './cockpitUi';
import type { PositionLiveSnapshot } from '../../api/portfolio';
import type { CockpitQuoteState } from './cockpitQuote';
import {
  QUOTE_PROVIDER_UNAVAILABLE,
  durationOrReason,
  moneyOrReason,
  numberOrReason,
  sizeOrReason,
  timestampOrReason,
} from './cockpitDisplay';

function RecentTradesTape({ symbol }: { symbol: string }) {
  const history = useLiveTradeHistory(symbol);
  const rows = history.slice(0, 12);
  return (
    <div className="mt-3 border-t border-intel-line pt-3">
      <div className="mb-1 text-[10px] uppercase tracking-widest text-intel-ink3">Recent trades</div>
      {rows.length === 0 ? (
        <p className="text-[11px] text-intel-ink3">No trade prints received for this contract yet.</p>
      ) : (
        <div className="max-h-32 overflow-y-auto">
          <table className="w-full text-[11px] tabular-nums">
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="border-b border-intel-lineSoft last:border-b-0">
                  <td className="py-0.5 text-intel-ink3">
                    {new Date(t.timestamp).toLocaleTimeString([], { hour12: false })}
                  </td>
                  <td className="py-0.5 text-right text-intel-ink">{moneyOrReason(t.price, 'Print price unavailable')}</td>
                  <td className="py-0.5 text-right text-intel-ink2">{sizeOrReason(t.size, 'Print size unavailable')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Dot colour per unified status, in the cockpit's own palette. Only LIVE
// animates — a static or dropped feed must never look like it is streaming.
const STATUS_DOT: Record<MarketDataStatus, string> = {
  LIVE: 'bg-intel-pos animate-pulse',
  SNAPSHOT: 'bg-intel-info',
  DELAYED: 'bg-intel-warn',
  STALE: 'bg-intel-warn',
  DISCONNECTED: 'bg-intel-neg',
};

/** Unified market-data status chip in the cockpit theme. */
function StatusChip({ status }: { status: MarketDataStatus | null }) {
  const dot = status ? STATUS_DOT[status] : 'bg-intel-ink3';
  const tone =
    status === 'LIVE'
      ? 'text-intel-pos'
      : status === 'DISCONNECTED'
        ? 'text-intel-neg'
        : status === 'STALE' || status === 'DELAYED'
          ? 'text-intel-warn'
          : status === 'SNAPSHOT'
            ? 'text-intel-info'
            : 'text-intel-ink3';
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] uppercase tracking-widest ${tone}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {marketDataStatusLabel(status)}
    </span>
  );
}

function QuoteHealthBar({
  quote,
  lastUpdate,
}: {
  quote: CockpitQuoteState;
  lastUpdate: number | null;
}) {
  const ageLabel = durationOrReason(quote.quoteAgeMs, 'Quote timestamp unavailable');
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-intel-line pt-3 text-[11px] text-intel-ink3">
      <StatusChip status={quote.status} />
      <span>quote age {ageLabel}</span>
      <span>updated {timestampOrReason(lastUpdate, 'Quote timestamp unavailable')}</span>
    </div>
  );
}

/**
 * Live option market for the held contract. The price fields themselves are
 * canonical in the trade header; this panel shows whether the shared cockpit
 * quote is present, quote freshness, REST-only contract stats, and prints.
 * Greeks/IV moved to Position & Health so risk lives with the position.
 */
export function LiveMarketPanel({
  symbol,
  greeks,
  quote,
}: {
  symbol: string;
  greeks?: PositionLiveSnapshot | null;
  quote: CockpitQuoteState;
}) {
  const lastTrade = useLiveTrade(symbol);
  const volume = finiteOrNull(greeks?.dayVolume);
  const openInterest = finiteOrNull(greeks?.openInterest);
  const last = finiteOrNull(lastTrade?.price);

  return (
    <Panel title="Live Market" badge={<Badge tone="neutral">NBBO</Badge>}>
      {quote.hasQuote ? (
        <div className="rounded-panel border border-intel-line bg-intel-panel2 p-3" data-testid="live-market-quote-status">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-intel-ink3">NBBO source</div>
              <div className="text-sm font-semibold text-intel-ink">
                {quote.status === 'LIVE'
                  ? 'Streaming quote available'
                  : quote.status === 'DISCONNECTED'
                    ? 'Live socket disconnected — showing last quote'
                    : quote.status === 'STALE'
                      ? 'Quote stale — awaiting a newer tick'
                      : 'Snapshot quote available'}
              </div>
              {quote.status && quote.status !== 'LIVE' ? (
                <div className="mt-0.5 text-[11px] text-intel-warn">
                  Live NBBO socket has not delivered a newer tick for this contract.
                </div>
              ) : null}
            </div>
            <StatusChip status={quote.status} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-intel-ink3">Last</div>
              <div className="text-sm font-semibold tabular-nums text-intel-ink">{moneyOrReason(last, 'No trade prints received')}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-intel-ink3">Volume</div>
              <div className="text-sm font-semibold tabular-nums text-intel-ink">{numberOrReason(volume, 'Unavailable from current provider')}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-intel-ink3">Open interest</div>
              <div className="text-sm font-semibold tabular-nums text-intel-ink">{numberOrReason(openInterest, 'Unavailable from current provider')}</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-panel border border-intel-line bg-intel-panel2 p-4 text-sm text-intel-ink3">
          {quote.unavailableReason ?? QUOTE_PROVIDER_UNAVAILABLE}
        </div>
      )}
      <RecentTradesTape symbol={symbol} />
      {quote.hasQuote ? <QuoteHealthBar quote={quote} lastUpdate={quote.lastUpdate} /> : null}
    </Panel>
  );
}
