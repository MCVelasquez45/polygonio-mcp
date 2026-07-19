import type { PositionLiveSnapshot } from '../../api/portfolio';
import {
  computeUnrealizedPnl,
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
  const delta = finiteOrNull(greeks?.greeks?.delta);
  const vega = finiteOrNull(greeks?.greeks?.vega);
  const thetaDecay = theta !== null && contracts !== null ? theta * 100 * Math.abs(contracts) : null;

  const dte = greeks?.daysToExpiration ?? trade.daysToExpiration ?? null;
  const livePnl = computeUnrealizedPnl(quote.mark, trade.entryPrice, contracts) ?? finiteOrNull(trade.unrealizedPnl);
  const dailyPnl = finiteOrNull(trade.dailyPnl);
  const aiRecommendation =
    trade.currentAiRecommendation ??
    trade.aiRecommendation ??
    trade.lifecycleStatus ??
    trade.exitReason ??
    null;

  return (
    <Panel title="Position &amp; Health">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Entry" value={moneyOrReason(entry, 'Entry price not captured')} />
        <Stat label="Current" value={moneyOrReason(quote.mark, 'Mark unavailable from provider')} />
        <Stat label="Live P/L" value={signedMoneyOrReason(livePnl, 'Requires entry and mark')} tone={livePnl !== null && livePnl < 0 ? 'bad' : livePnl !== null ? 'good' : 'muted'} />
        <Stat label="Daily P/L" value={signedMoneyOrReason(dailyPnl, 'Not captured for this position')} tone={dailyPnl !== null && dailyPnl < 0 ? 'bad' : dailyPnl !== null ? 'good' : 'muted'} />
        <Stat
          label="Risk at entry"
          value={moneyOrReason(cost, 'Requires entry price and quantity')}
          sub={bpSub}
        />
        <Stat label="Current exposure" value={moneyOrReason(marketValue, 'Requires mark and quantity')} />
        <Stat label="Delta" value={delta !== null ? delta.toFixed(3) : 'Delta unavailable'} tone="muted" />
        <Stat label="Theta decay / day" value={signedMoneyOrReason(thetaDecay, 'Theta unavailable from provider')} tone={thetaDecay !== null && thetaDecay < 0 ? 'bad' : 'neutral'} />
        <Stat label="Vega" value={vega !== null ? vega.toFixed(3) : 'Vega unavailable'} tone="muted" />
        <Stat label="DTE" value={dte != null ? `${dte}d` : 'Expiration not captured'} />
        <Stat label="AI Rec" value={aiRecommendation ?? 'No recommendation captured'} tone="muted" />
        <Stat label="Exit Target" value={moneyOrReason(trade.targetPrice, 'Target not captured')} tone="good" />
        <Stat label="Stop Level" value={moneyOrReason(trade.stopPrice, 'Stop not captured')} tone="bad" />
        <Stat label="MFE" value={signedMoneyOrReason(trade.mfe, 'Not captured for this position')} tone="muted" />
        <Stat label="MAE" value={signedMoneyOrReason(trade.mae, 'Not captured for this position')} tone="muted" />
      </div>
      <GreeksGrid greeks={greeks ?? null} />
    </Panel>
  );
}
