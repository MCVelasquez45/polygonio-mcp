import { useLiveTrade, useLiveTradeHistory } from '../../lib/liveMarketStore';
import { finiteOrNull } from '../../lib/marketFormat';
import { Panel, Badge, FreshnessDot } from './cockpitUi';
import { GreeksGrid } from './GreeksGrid';
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
    <div className="mt-3 border-t border-gray-900 pt-3">
      <div className="mb-1 text-[10px] uppercase tracking-widest text-gray-500">Recent trades</div>
      {rows.length === 0 ? (
        <p className="text-[11px] text-gray-600">No trade prints received for this contract yet.</p>
      ) : (
        <div className="max-h-32 overflow-y-auto">
          <table className="w-full text-[11px] tabular-nums">
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="border-b border-gray-900/60 last:border-b-0">
                  <td className="py-0.5 text-gray-500">
                    {new Date(t.timestamp).toLocaleTimeString([], { hour12: false })}
                  </td>
                  <td className="py-0.5 text-right text-white">{moneyOrReason(t.price, 'Print price unavailable')}</td>
                  <td className="py-0.5 text-right text-gray-400">{sizeOrReason(t.size, 'Print size unavailable')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
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
  const sourceLabel = quote.source === 'live' ? 'Streaming quote' : quote.source === 'snapshot' ? 'Snapshot quote' : 'Quote';
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-gray-900 pt-3 text-[11px] text-gray-500">
      <span className="inline-flex items-center gap-1">
        <span className={`h-1.5 w-1.5 rounded-full ${quote.hasQuote ? 'bg-emerald-400' : 'bg-gray-600'}`} />
        {sourceLabel}
      </span>
      <FreshnessDot freshness={quote.freshness} />
      <span>quote age {ageLabel}</span>
      <span>updated {timestampOrReason(lastUpdate, 'Quote timestamp unavailable')}</span>
    </div>
  );
}

/**
 * Live option market for the held contract. The price fields themselves are
 * canonical in the trade header; this panel shows whether the shared cockpit
 * quote is present, quote freshness, REST-only contract stats, and prints.
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
        <div className="rounded-lg border border-gray-900 bg-black/30 p-3" data-testid="live-market-quote-status">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-gray-500">NBBO source</div>
              <div className="text-sm font-semibold text-white">
                {quote.source === 'live' ? 'Streaming quote available' : 'Snapshot quote available'}
              </div>
              {quote.source === 'snapshot' ? (
                <div className="mt-0.5 text-[11px] text-amber-200">
                  Live NBBO socket has not delivered a newer tick for this contract.
                </div>
              ) : null}
            </div>
            <FreshnessDot freshness={quote.freshness} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-gray-500">Last</div>
              <div className="text-sm font-semibold tabular-nums text-white">{moneyOrReason(last, 'No trade prints received')}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-gray-500">Volume</div>
              <div className="text-sm font-semibold tabular-nums text-white">{numberOrReason(volume, 'Unavailable from current provider')}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-gray-500">Open interest</div>
              <div className="text-sm font-semibold tabular-nums text-white">{numberOrReason(openInterest, 'Unavailable from current provider')}</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-gray-900 bg-black/30 p-4 text-sm text-gray-500">
          {quote.unavailableReason ?? QUOTE_PROVIDER_UNAVAILABLE}
        </div>
      )}
      <GreeksGrid greeks={greeks ?? null} />
      <RecentTradesTape symbol={symbol} />
      {quote.hasQuote ? <QuoteHealthBar quote={quote} lastUpdate={quote.lastUpdate} /> : null}
    </Panel>
  );
}
