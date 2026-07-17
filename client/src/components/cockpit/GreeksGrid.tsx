import type { PositionLiveSnapshot } from '../../api/portfolio';
import { finiteOrNull } from '../../lib/marketFormat';
import { Badge } from './cockpitUi';
import { greekOrReason, percentOrReason } from './cockpitDisplay';

/**
 * Greeks / IV tiles for the held contract. OI and volume live in the market
 * summary, and DTE lives in Position Health, so this grid does not repeat them.
 */
export function GreeksGrid({ greeks }: { greeks: PositionLiveSnapshot | null }) {
  const g = greeks?.greeks;
  const ivPct = finiteOrNull(greeks?.impliedVolatility);
  const hasGreeks =
    finiteOrNull(g?.delta) !== null ||
    finiteOrNull(g?.gamma) !== null ||
    finiteOrNull(g?.theta) !== null ||
    finiteOrNull(g?.vega) !== null ||
    ivPct !== null;
  return (
    <div className="mt-3 border-t border-gray-900 pt-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest text-gray-500">Greeks &amp; contract</span>
        <Badge tone="neutral">3s</Badge>
      </div>
      {hasGreeks ? (
        <div className="grid grid-cols-5 gap-y-2 gap-x-2 text-center tabular-nums">
          <Cell label="Delta" value={greekOrReason(g?.delta, 'Not reported')} />
          <Cell label="Gamma" value={greekOrReason(g?.gamma, 'Not reported')} />
          <Cell label="Theta" value={greekOrReason(g?.theta, 'Not reported')} />
          <Cell label="Vega" value={greekOrReason(g?.vega, 'Not reported')} />
          <Cell label="IV" value={ivPct === null ? 'Not reported' : percentOrReason(ivPct <= 3 ? ivPct * 100 : ivPct, 'Not reported')} />
        </div>
      ) : (
        <p className="text-xs text-gray-600">Contract greeks are unavailable from the current provider snapshot.</p>
      )}
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-widest text-gray-500">{label}</span>
      <span className="text-sm font-semibold text-gray-100">{value}</span>
    </div>
  );
}
