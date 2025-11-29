import type { OptionContractDetail, OptionLeg } from '../../types/market';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { formatExpirationDate } from '../../utils/expirations';

const metrics = [
  { key: 'delta', label: 'Delta' },
  { key: 'gamma', label: 'Gamma' },
  { key: 'theta', label: 'Theta' },
  { key: 'vega', label: 'Vega' },
  { key: 'rho', label: 'Rho' },
] as const;

type GreekKey = typeof metrics[number]['key'];

type Props = {
  contract?: OptionContractDetail | null;
  leg?: OptionLeg | null;
  label?: string;
  underlyingPrice?: number | null;
};

type RiskSlice = {
  id: string;
  label: string;
  value: number;
  color: string;
  description: string;
};

const riskColors = ['#10b981', '#f97316', '#facc15', '#38bdf8', '#a855f7'];

export function GreeksPanel({ contract, leg, label, underlyingPrice }: Props) {
  const displayName = label ?? contract?.ticker ?? leg?.ticker ?? 'Select a contract';
  const resolvedExpiration = contract?.expiration ?? leg?.expiration ?? null;
  const resolvedStrike = typeof contract?.strike === 'number' ? contract.strike : leg?.strike ?? null;
  const contractType = contract?.type ?? leg?.type ?? null;
  const resolvedIV =
    typeof contract?.impliedVolatility === 'number'
      ? contract.impliedVolatility
      : typeof leg?.iv === 'number'
      ? leg.iv
      : null;
  const resolvedOpenInterest =
    typeof contract?.openInterest === 'number'
      ? contract.openInterest
      : typeof leg?.openInterest === 'number'
      ? leg.openInterest
      : null;
  const resolvedVolume = extractDayNumber(contract?.day, 'volume') ?? (typeof leg?.volume === 'number' ? leg.volume : null);
  const resolvedGreeks = metrics.reduce<Record<GreekKey, number | null>>((acc, metric) => {
    acc[metric.key] = resolveGreekValue(contract, leg, metric.key);
    return acc;
  }, {});
  const resolvedPremium = pickNumber(
    leg?.mark,
    leg?.mid,
    leg?.lastPrice,
    resolveQuoteMid(contract?.lastQuote),
    contract?.lastTrade?.price ?? null
  );
  const legBreakeven = pickNumber(leg?.breakeven, contract?.breakEvenPrice ?? null);
  const computedBreakeven =
    resolvedStrike != null && resolvedPremium != null && contractType
      ? contractType === 'call'
        ? resolvedStrike + resolvedPremium
        : resolvedStrike - resolvedPremium
      : null;
  const breakevenPrice = legBreakeven ?? computedBreakeven;
  const breakevenMove =
    breakevenPrice != null && typeof underlyingPrice === 'number' ? breakevenPrice - underlyingPrice : null;
  const breakevenPercent =
    breakevenMove != null && typeof underlyingPrice === 'number' && underlyingPrice !== 0
      ? (breakevenMove / underlyingPrice) * 100
      : null;
  const breakevenFormula =
    contractType && resolvedStrike != null && resolvedPremium != null
      ? `${formatCurrency(resolvedStrike)} ${contractType === 'call' ? '+' : '-'} ${formatCurrency(resolvedPremium)}`
      : null;
  const meta = [
    { label: 'Expiration', value: resolvedExpiration ? formatExpirationDate(resolvedExpiration) : '—' },
    { label: 'Strike', value: resolvedStrike != null ? `$${resolvedStrike.toFixed(2)}` : '—' },
    { label: 'Premium', value: resolvedPremium != null ? `$${resolvedPremium.toFixed(2)}` : '—' },
    { label: 'Breakeven', value: breakevenPrice != null ? `$${breakevenPrice.toFixed(2)}` : '—' },
    { label: 'Implied Vol', value: resolvedIV != null ? `${(resolvedIV * 100).toFixed(1)}%` : '—' },
    { label: 'Open Interest', value: resolvedOpenInterest != null ? resolvedOpenInterest.toLocaleString() : '—' },
  ];
  const riskProfile = buildRiskProfile(resolvedGreeks, { iv: resolvedIV, openInterest: resolvedOpenInterest, volume: resolvedVolume });
  const totalRiskValue = riskProfile.slices.reduce((sum, slice) => sum + slice.value, 0) || 1;

  return (
    <section className="bg-gray-950 border border-gray-900 rounded-2xl p-4 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-gray-500">Greeks + Risk</p>
          <p className="text-lg font-semibold text-gray-100">{displayName}</p>
        </div>
        {(contract?.type ?? leg?.type) && (
          <span className={`px-3 py-1 text-xs rounded-full border ${
            (contract?.type ?? leg?.type) === 'call'
              ? 'border-emerald-500/40 text-emerald-300'
              : 'border-red-500/40 text-red-300'
          }`}>
            {(contract?.type ?? leg?.type)?.toUpperCase()}
          </span>
        )}
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
        {meta.map(item => (
          <div key={item.label} className="rounded-2xl border border-gray-900 bg-gray-950 p-3">
            <p className="text-xs uppercase tracking-widest text-gray-500">{item.label}</p>
            <p className="text-base font-semibold text-white mt-1">{item.value}</p>
          </div>
        ))}
      </div>

      {breakevenPrice != null && resolvedPremium != null && resolvedStrike != null && contractType && (
        <div className="border border-gray-900 rounded-2xl p-4 bg-gray-950 space-y-2">
          <p className="text-xs uppercase tracking-[0.4em] text-gray-500">Breakeven Calculator</p>
          <p className="text-lg font-semibold text-white">
            Needs {displayName} {contractType === 'call' ? '≥' : '≤'} ${breakevenPrice.toFixed(2)}
          </p>
          <p className="text-sm text-gray-400">
            {contractType === 'call' ? 'Strike + Premium' : 'Strike - Premium'} ({breakevenFormula})
          </p>
          {breakevenMove != null && breakevenPercent != null && (
            <p className="text-xs text-gray-500">
              Current {label ?? 'price'} {underlyingPrice != null ? `$${underlyingPrice.toFixed(2)}` : '—'} · Move{' '}
              {breakevenMove >= 0 ? '+' : '-'}${Math.abs(breakevenMove).toFixed(2)} ({Math.abs(breakevenPercent).toFixed(2)}%)
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {metrics.map(metric => (
          <div key={metric.key} className="rounded-2xl border border-gray-900 bg-gray-950 p-3">
            <p className="text-xs uppercase tracking-widest text-gray-500">{metric.label}</p>
            <p className="text-xl font-semibold text-white mt-1">
              {resolvedGreeks[metric.key] != null ? Number(resolvedGreeks[metric.key]).toFixed(4) : '—'}
            </p>
          </div>
        ))}
      </div>

      <div className="border border-gray-900 rounded-2xl p-4 bg-gray-950 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-gray-500">Risk Profile</p>
            <p className="text-base font-semibold text-white">
              {riskProfile.label} {riskProfile.score != null ? `· ${(riskProfile.score * 100).toFixed(0)}%` : ''}
            </p>
            <p className="text-xs text-gray-400 max-w-xl">{riskProfile.description}</p>
          </div>
        </div>
        {riskProfile.slices.length ? (
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="w-full lg:w-1/2 h-44">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={riskProfile.slices}
                    dataKey="value"
                    innerRadius={50}
                    outerRadius={80}
                    stroke="none"
                    paddingAngle={1}
                  >
                    {riskProfile.slices.map(slice => (
                      <Cell key={slice.id} fill={slice.color} />
                    ))}
                  </Pie>
                  <text
                    x="50%"
                    y="50%"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="#e5e7eb"
                    fontSize="16"
                    fontWeight="600"
                  >
                    {(riskProfile.score ?? 0).toFixed(2)}
                  </text>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              {riskProfile.slices.map(slice => (
                <div key={slice.id} className="rounded-xl border border-gray-900 bg-gray-950 p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: slice.color }} />
                      <p className="text-gray-200 font-medium">{slice.label}</p>
                    </div>
                    <p className="text-white font-semibold">{Math.round((slice.value / totalRiskValue) * 100)}%</p>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">{slice.description}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500">Select a contract with Greeks and liquidity data to preview its risk mix.</p>
        )}
      </div>
    </section>
  );
}

function resolveGreekValue(contract?: OptionContractDetail | null, leg?: OptionLeg | null, key: GreekKey) {
  if (contract?.greeks && typeof (contract.greeks as any)[key] === 'number') {
    return Number((contract.greeks as any)[key]);
  }
  if (leg && typeof (leg as any)[key] === 'number') {
    return Number((leg as any)[key]);
  }
  if (leg?.greeks && typeof (leg.greeks as any)[key] === 'number') {
    return Number((leg.greeks as any)[key]);
  }
  return null;
}

function extractDayNumber(day: Record<string, unknown> | undefined, field: string) {
  if (!day || typeof day !== 'object') return null;
  const value = (day as any)[field];
  return typeof value === 'number' ? value : null;
}

function buildRiskProfile(
  greeks: Record<GreekKey, number | null>,
  context: { iv: number | null; openInterest: number | null; volume: number | null }
): { slices: RiskSlice[]; score: number | null; label: string; description: string } {
  const directional = clamp01(Math.abs(greeks.delta ?? 0));
  const convexity = clamp01(Math.abs(greeks.gamma ?? 0) / 0.15);
  const decay = clamp01(Math.abs(greeks.theta ?? 0) / 0.08);
  const volatilityComponent = clamp01(Math.abs(greeks.vega ?? 0) / 0.25);
  const impliedComponent = clamp01((context.iv ?? 0) / 1.5);
  const volatility = clamp01(volatilityComponent * 0.7 + impliedComponent * 0.3);
  const depthScore = (() => {
    const oi = typeof context.openInterest === 'number' ? Math.min(context.openInterest, 6000) / 6000 : 0;
    const volume = typeof context.volume === 'number' ? Math.min(context.volume, 500) / 500 : 0;
    return clamp01(oi * 0.7 + volume * 0.3);
  })();
  const liquidity = clamp01(1 - depthScore);
  const slices: RiskSlice[] = [
    {
      id: 'directional',
      label: 'Directional',
      value: directional,
      color: riskColors[0],
      description: 'Delta exposure vs. underlying trend.',
    },
    {
      id: 'convexity',
      label: 'Convexity',
      value: convexity,
      color: riskColors[1],
      description: 'Gamma swings if the underlying gaps.',
    },
    {
      id: 'decay',
      label: 'Time Decay',
      value: decay,
      color: riskColors[2],
      description: 'Daily theta bleed against the position.',
    },
    {
      id: 'volatility',
      label: 'Volatility',
      value: volatility,
      color: riskColors[3],
      description: 'Sensitivity to implied volatility shocks.',
    },
    {
      id: 'liquidity',
      label: 'Liquidity',
      value: liquidity,
      color: riskColors[4],
      description: 'Depth/exit quality from open interest + volume.',
    },
  ].filter(slice => slice.value > 0.01);

  if (!slices.length) {
    return { slices: [], score: null, label: 'No Data', description: 'Awaiting Greeks, IV, or volume before scoring risk.' };
  }

  const score = clamp01(
    directional * 0.3 + convexity * 0.15 + decay * 0.2 + volatility * 0.2 + liquidity * 0.15
  );
  const classification =
    score < 0.35
      ? {
          label: 'Defensive',
          description: 'Premium profile skews low risk with manageable Greeks and solid depth.',
        }
      : score < 0.65
      ? {
          label: 'Balanced',
          description: 'Risk is diversified across delta, decay, and liquidity—monitor IV swings.',
        }
      : {
          label: 'Aggressive',
          description: 'Elevated directional/volatility risk; size accordingly or hedge.',
        };

  return {
    slices,
    score,
    label: classification.label,
    description: classification.description,
  };
}

function clamp01(value: number) {
  if (Number.isNaN(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}

function pickNumber(...values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function resolveQuoteMid(quote: Record<string, unknown> | undefined | null): number | null {
  if (!quote) return null;
  const bid = typeof (quote as any).bid === 'number' ? (quote as any).bid : (quote as any).bidPrice ?? (quote as any).bid_price;
  const ask = typeof (quote as any).ask === 'number' ? (quote as any).ask : (quote as any).askPrice ?? (quote as any).ask_price;
  if (typeof (quote as any).mid === 'number') return (quote as any).mid;
  if (typeof bid === 'number' && typeof ask === 'number') {
    return (bid + ask) / 2;
  }
  return null;
}

function formatCurrency(value: number) {
  return `$${value.toFixed(2)}`;
}
