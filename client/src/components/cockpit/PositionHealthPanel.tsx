import type { PositionLiveSnapshot } from '../../api/portfolio';
import {
  fmtPercent,
  finiteOrNull,
} from '../../lib/marketFormat';
import { Panel, Stat, type CockpitTrade } from './cockpitUi';
import type { CockpitQuoteState } from './cockpitQuote';
import { moneyOrReason, signedMoneyOrReason } from './cockpitDisplay';
import { GreeksGrid } from './GreeksGrid';

/**
 * Position & Health shows risk, exposure, and the contract greeks (risk lives
 * with the position, not with market data). Entry, mark, P/L, return and
 * time-in-trade are canonical in the trade header and are not repeated here.
 */
export function PositionHealthPanel({
  trade,
  greeks,
  buyingPower,
  quote,
}: {
  trade: CockpitTrade;
  greeks: PositionLiveSnapshot | null;
  buyingPower: number | null;
  quote: CockpitQuoteState;
}) {
  const contracts = finiteOrNull(trade.contracts);
  const entry = finiteOrNull(trade.entryPrice);

  const marketValue = quote.mark !== null && contracts !== null ? quote.mark * Math.abs(contracts) * 100 : null;
  const cost = entry !== null && contracts !== null ? entry * Math.abs(contracts) * 100 : null;
  const bpImpactPct = cost !== null && buyingPower && buyingPower > 0 ? (cost / buyingPower) * 100 : null;
  const bpSub =
    bpImpactPct !== null
      ? `${fmtPercent(bpImpactPct)} of buying power`
      : cost !== null
        ? 'Buying power unavailable from broker account'
        : undefined;

  // Theta is per-share per-day; ×100×contracts = daily $ decay for the position.
  const theta = finiteOrNull(greeks?.greeks?.theta);
  const thetaDecay = theta !== null && contracts !== null ? theta * 100 * Math.abs(contracts) : null;

  const dte = greeks?.daysToExpiration ?? trade.daysToExpiration ?? null;

  return (
    <Panel title="Position &amp; Health">
      <div className="grid grid-cols-2 gap-3">
        <Stat
          label="Risk at entry"
          value={moneyOrReason(cost, 'Requires entry price and quantity')}
          sub={bpSub}
        />
        <Stat label="Current exposure" value={moneyOrReason(marketValue, 'Requires mark and quantity')} />
        <Stat label="Theta decay / day" value={signedMoneyOrReason(thetaDecay, 'Theta unavailable from provider')} tone={thetaDecay !== null && thetaDecay < 0 ? 'bad' : 'neutral'} />
        <Stat label="DTE" value={dte != null ? `${dte}d` : 'Expiration not captured'} />
        <Stat label="MFE" value={signedMoneyOrReason(trade.mfe, 'Not captured for this position')} tone="muted" />
        <Stat label="MAE" value={signedMoneyOrReason(trade.mae, 'Not captured for this position')} tone="muted" />
      </div>
      <GreeksGrid greeks={greeks ?? null} />
    </Panel>
  );
}
