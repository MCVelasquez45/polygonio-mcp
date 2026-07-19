import { useNow } from '../../hooks/useNow';
import {
  computeUnrealizedPnl,
  computeUnrealizedPnlPct,
  finiteOrNull,
} from '../../lib/marketFormat';
import { Pill, type CockpitTrade } from './cockpitUi';
import type { CockpitQuoteState } from './cockpitQuote';
import { contractLabel } from './occSymbol';
import {
  QUOTE_PROVIDER_UNAVAILABLE,
  durationOrReason,
  moneyOrReason,
  numberOrReason,
  percentOrReason,
  signedMoneyOrReason,
} from './cockpitDisplay';

/**
 * Top-of-cockpit identity bar. This is the canonical location for contract,
 * direction, quantity, entry, mark, P/L, return, bid, ask, mid, and spread.
 */
export function CockpitCommandBar({
  trade,
  quote,
  actions,
}: {
  trade: CockpitTrade;
  quote: CockpitQuoteState;
  actions?: React.ReactNode;
}) {
  const now = useNow(1000);
  const openedAt = trade.filledTime ? Date.parse(trade.filledTime) : NaN;
  const heldMs = Number.isFinite(openedAt) ? now - openedAt : null;
  const directionTone = trade.direction === 'BULLISH' ? 'good' : trade.direction === 'BEARISH' ? 'bad' : 'neutral';
  const contracts = finiteOrNull(trade.contracts);
  const pnl = computeUnrealizedPnl(quote.mark, trade.entryPrice, contracts) ?? finiteOrNull(trade.unrealizedPnl);
  const pnlPct = computeUnrealizedPnlPct(quote.mark, trade.entryPrice) ?? finiteOrNull(trade.unrealizedPnlPct);
  const pnlTone = pnl === null ? 'neutral' : pnl >= 0 ? 'good' : 'bad';

  return (
    <div
      data-testid="cockpit-command-bar"
      className="rounded-panel border border-intel-line bg-intel-panel px-4 py-3 sm:px-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="min-w-0 text-xl font-semibold text-intel-ink sm:text-2xl">
              {contractLabel(trade.optionSymbol)}
            </h2>
            {trade.direction ? <Pill tone={directionTone}>{String(trade.direction)}</Pill> : null}
            <span className="text-sm font-semibold text-intel-ink2">Long {numberOrReason(contracts, 'Quantity not captured')}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-intel-ink3">
            <span className="tabular-nums">held {durationOrReason(heldMs, 'Fill time not captured')}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {actions}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-intel-ink3">Entry</div>
          <div className="text-sm font-semibold tabular-nums text-intel-ink">{moneyOrReason(trade.entryPrice, 'Entry price not captured')}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-intel-ink3">Mark</div>
          <div className="text-sm font-semibold tabular-nums text-intel-ink">{moneyOrReason(quote.mark, 'Mark unavailable from provider')}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-intel-ink3">P&amp;L</div>
          <div className={`text-lg font-semibold tabular-nums ${pnlTone === 'good' ? 'text-intel-pos' : pnlTone === 'bad' ? 'text-intel-neg' : 'text-intel-ink'}`}>
            {signedMoneyOrReason(pnl, 'Requires entry and mark')}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-intel-ink3">Return</div>
          <div className={`text-sm font-semibold tabular-nums ${pnlTone === 'good' ? 'text-intel-pos' : pnlTone === 'bad' ? 'text-intel-neg' : 'text-intel-ink'}`}>
            {percentOrReason(pnlPct, 'Requires entry and mark')}
          </div>
        </div>
        {quote.hasQuote ? (
          <>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-intel-ink3">Bid</div>
              <div className="text-sm font-semibold tabular-nums text-intel-pos">{moneyOrReason(quote.bid, 'Bid unavailable from provider')}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-intel-ink3">Ask</div>
              <div className="text-sm font-semibold tabular-nums text-intel-neg">{moneyOrReason(quote.ask, 'Ask unavailable from provider')}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-intel-ink3">Mid</div>
              <div className="text-sm font-semibold tabular-nums text-intel-ink">{moneyOrReason(quote.mid, 'Mid unavailable from provider')}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-intel-ink3">Spread</div>
              <div className="text-sm font-semibold tabular-nums text-intel-ink2">
                {moneyOrReason(quote.spreadAbs, 'Spread unavailable from provider')}{' '}
                <span className="text-[11px] text-intel-ink3">/ {percentOrReason(quote.spreadPct, 'Spread percent unavailable')}</span>
              </div>
            </div>
          </>
        ) : (
          <div className="col-span-2 rounded border border-intel-line bg-intel-panel2 p-2 text-xs text-intel-ink3 sm:col-span-4">
            {QUOTE_PROVIDER_UNAVAILABLE}
          </div>
        )}
      </div>
    </div>
  );
}
