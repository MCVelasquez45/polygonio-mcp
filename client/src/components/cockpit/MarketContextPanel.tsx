import { fmtNumber, fmtPercent, finiteOrNull } from '../../lib/marketFormat';
import { Panel, Stat, Badge, type CockpitTrade } from './cockpitUi';

function trendTone(trend: string | null): 'good' | 'bad' | 'neutral' {
  if (trend === 'UP') return 'good';
  if (trend === 'DOWN') return 'bad';
  return 'neutral';
}

/**
 * Market Context - why this trade exists in the current tape. Trend, relative
 * volume, options-flow score and regime, sourced from the evaluation that opened
 * the position. Underlying pricing is DELAYED on the Options Advanced plan; the
 * badge says so rather than implying a real-time underlying.
 */
export function MarketContextPanel({ trade }: { trade: CockpitTrade }) {
  const ctx = trade.marketContext;
  const relVol = finiteOrNull(ctx?.relativeVolume);
  const flowScore = finiteOrNull(ctx?.flowScore);
  const hasContext = Boolean(ctx && (ctx.trend || relVol !== null || flowScore !== null || ctx.regime));
  const underlyingStatus = ctx ? (ctx.underlyingDelayed ? 'Delayed' : 'Realtime') : 'No market context snapshot';
  return (
    <Panel
      title="Market Context"
      badge={ctx?.underlyingDelayed ? <Badge tone="warn">Delayed</Badge> : undefined}
    >
      {!hasContext ? (
        <p className="text-xs text-gray-600">No market context snapshot was captured for this trade.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {ctx?.trend ? <Stat label="Trend" value={ctx.trend} tone={trendTone(ctx.trend)} /> : null}
            {relVol !== null ? <Stat label="Relative volume" value={`${relVol.toFixed(2)}x`} /> : null}
            {flowScore !== null ? (
              <Stat
                label="Options flow score"
                value={flowScore <= 1 ? fmtPercent(flowScore * 100) : fmtNumber(flowScore, 2)}
              />
            ) : null}
            {ctx?.regime ? <Stat label="Regime" value={ctx.regime} /> : null}
            <Stat label="Underlying data" value={underlyingStatus} tone={ctx?.underlyingDelayed ? 'muted' : 'neutral'} />
          </div>
          <p className="mt-3 text-[10px] text-gray-600">
            Trend and regime are derived from the evaluation snapshot that opened this position. Delayed means the
            underlying tape is not being presented as realtime.
          </p>
        </>
      )}
    </Panel>
  );
}
