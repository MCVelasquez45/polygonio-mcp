import type { OptionContractDetail, OptionLeg } from '../../types/market';
import { PieChart, Pie, Cell } from 'recharts';
import { MeasuredContainer } from '../shared/MeasuredContainer';
import { formatExpirationDate } from '../../utils/expirations';

const metrics = [
  { key: 'delta', label: 'Delta' },
  { key: 'gamma', label: 'Gamma' },
  { key: 'theta', label: 'Theta' },
  { key: 'vega', label: 'Vega' },
  { key: 'rho', label: 'Rho' },
] as const;

type GreekKey = (typeof metrics)[number]['key'];

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

const EMPTY_GREEKS: Record<GreekKey, number | null> = {
  delta: null,
  gamma: null,
  theta: null,
  vega: null,
  rho: null,
};

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
  const resolvedVolume =
    extractDayNumber(contract?.day, 'volume') ?? (typeof leg?.volume === 'number' ? leg.volume : null);
  const resolvedGreeks = metrics.reduce<Record<GreekKey, number | null>>(
    (acc, metric) => {
      acc[metric.key] = resolveGreekValue(contract, leg, metric.key);
      return acc;
    },
    { ...EMPTY_GREEKS }
  );
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
  const riskProfile = buildRiskProfile(resolvedGreeks, {
    iv: resolvedIV,
    openInterest: resolvedOpenInterest,
    volume: resolvedVolume,
  });
  const totalRiskValue = riskProfile.slices.reduce((sum, slice) => sum + slice.value, 0) || 1;
  const spread = resolveSpread(leg, contract);
  const itmProbability = typeof resolvedGreeks.delta === 'number' ? Math.abs(resolvedGreeks.delta) * 100 : null;
  const checklistEntries = buildEntryChecklist({
    strike: resolvedStrike,
    premium: resolvedPremium,
    breakeven: breakevenPrice,
    underlyingPrice,
    delta: resolvedGreeks.delta,
    iv: resolvedIV,
    theta: resolvedGreeks.theta,
    openInterest: resolvedOpenInterest,
    spread,
  });

  return (
    <section className="bg-gray-950 border border-gray-900 rounded-2xl p-4 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-gray-500">Greeks + Risk</p>
          <p className="text-lg font-semibold text-gray-100">{displayName}</p>
        </div>
        {(contract?.type ?? leg?.type) && (
          <span
            className={`px-3 py-1 text-xs rounded-full border ${
              (contract?.type ?? leg?.type) === 'call'
                ? 'border-emerald-500/40 text-emerald-300'
                : 'border-red-500/40 text-red-300'
            }`}
          >
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

      <div className="border border-gray-900 rounded-2xl p-4 bg-gray-950 space-y-3">
        <p className="text-xs uppercase tracking-[0.4em] text-gray-500">Entry Checklist</p>
        <div className="space-y-3">
          {checklistEntries.map(entry => (
            <div
              key={entry.key}
              className={`rounded-xl border px-3 py-2 text-sm ${toneToBorder(entry.tone)} ${toneToBackground(entry.tone)}`}
            >
              <p className="font-semibold text-white">{entry.label}</p>
              <p className="text-gray-200">{entry.primary}</p>
              <p className="text-xs text-gray-400 mt-1">{entry.detail}</p>
            </div>
          ))}
        </div>
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
          {itmProbability != null && (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-center">
              <p className="text-[10px] uppercase tracking-[0.3em] text-emerald-200">ITM odds</p>
              <p className="text-lg font-semibold text-emerald-200">{itmProbability.toFixed(0)}%</p>
              <p className="text-[11px] text-emerald-100/80">Delta-based chance this contract expires in the money.</p>
            </div>
          )}
        </div>
        {riskProfile.slices.length ? (
          <div className="flex flex-col lg:flex-row gap-4">
            <MeasuredContainer className="w-full lg:w-1/2 h-44 min-w-0" minWidth={220} minHeight={176} height={176}>
              {({ width, height }) => (
                <PieChart width={width} height={height}>
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
              )}
            </MeasuredContainer>
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

function resolveGreekValue(
  contract: OptionContractDetail | null | undefined,
  leg: OptionLeg | null | undefined,
  key: GreekKey
) {
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
      description: 'Higher = trade behaves like stock (delta heavy).',
    },
    {
      id: 'convexity',
      label: 'Convexity',
      value: convexity,
      color: riskColors[1],
      description: 'Measures how jumpy the contract is on gaps (gamma).',
    },
    {
      id: 'decay',
      label: 'Time Decay',
      value: decay,
      color: riskColors[2],
      description: 'Daily theta bleed pressure.',
    },
    {
      id: 'volatility',
      label: 'Volatility',
      value: volatility,
      color: riskColors[3],
      description: 'How much IV swings drive P/L.',
    },
    {
      id: 'liquidity',
      label: 'Liquidity',
      value: liquidity,
      color: riskColors[4],
      description: 'Lower scores mean better depth + tighter spreads.',
    },
  ].filter(slice => slice.value > 0.01);

  if (!slices.length) {
    return { slices: [], score: null, label: 'No Data', description: 'Waiting for Greeks or volume before scoring risk.' };
  }

  const score = clamp01(directional * 0.3 + convexity * 0.15 + decay * 0.2 + volatility * 0.2 + liquidity * 0.15);
  const classification =
    score < 0.35
      ? {
          label: 'Defensive',
          description: 'Low stress: Greeks and liquidity are balanced.',
        }
      : score < 0.65
      ? {
          label: 'Balanced',
          description: 'Risk is spread out—keep an eye on IV swings.',
        }
      : {
          label: 'Aggressive',
          description: 'Elevated directional/IV risk. Size smaller or hedge.',
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

type ChecklistEntry = {
  key: string;
  label: string;
  primary: string;
  detail: string;
  tone: 'good' | 'warn' | 'alert' | 'neutral';
};

function buildEntryChecklist(args: {
  strike: number | null;
  premium: number | null;
  breakeven: number | null;
  underlyingPrice: number | null | undefined;
  delta: number | null;
  iv: number | null;
  theta: number | null;
  openInterest: number | null;
  spread: number | null;
}): ChecklistEntry[] {
  const entries: ChecklistEntry[] = [];
  const { breakeven, underlyingPrice, delta, iv, theta, openInterest, spread } = args;
  if (breakeven != null && typeof underlyingPrice === 'number') {
    const diff = breakeven - underlyingPrice;
    const moveNeeded = diff > 0 ? `$${Math.abs(diff).toFixed(2)} higher` : `$${Math.abs(diff).toFixed(2)} cushion`;
    entries.push({
      key: 'breakeven',
      label: 'Break-even vs. Spot',
      primary:
        diff > 0
          ? `Needs ${moveNeeded} to clear $${breakeven.toFixed(2)}`
          : `Already beyond break-even by ${moveNeeded}`,
      detail:
        diff > 0
          ? 'Only enter if price is accelerating toward this level—momentum + volume confirm follow-through.'
          : 'When price is above break-even, focus on trailing risk and locking gains.',
      tone: diff > 0 ? 'warn' : 'good',
    });
  } else {
    entries.push({
      key: 'breakeven',
      label: 'Break-even vs. Spot',
      primary: 'Need underlying + premium data to compare.',
      detail: 'Select an option with a live underlying snapshot so we can gauge distance to break-even.',
      tone: 'neutral',
    });
  }

  if (typeof delta === 'number') {
    const probability = Math.abs(delta) * 100;
    entries.push({
      key: 'delta',
      label: 'Contract Delta',
      primary: `Behaves like ${delta.toFixed(2)} shares (~${probability.toFixed(0)}% ITM odds).`,
      detail:
        probability >= 50
          ? 'This is “stock-like” exposure—expect responsive P/L. Desk rule: stay above 0.50 for intraday scalps.'
          : 'Below 0.50 delta trades slower and needs more time. Size smaller or pick a closer strike.',
      tone: probability >= 50 ? 'good' : 'warn',
    });
  } else {
    entries.push({
      key: 'delta',
      label: 'Contract Delta',
      primary: 'Delta unavailable.',
      detail: 'Cannot estimate chance of profit without delta. Reload the chain or pick another strike.',
      tone: 'alert',
    });
  }

  if (typeof iv === 'number') {
    const ivPercent = iv * 100;
    entries.push({
      key: 'iv',
      label: 'Implied Volatility',
      primary: `IV at ${ivPercent.toFixed(1)}%.`,
      detail:
        ivPercent <= 35
          ? 'Attractive levels—buying premium is efficient while IV trends lower.'
          : 'Elevated IV: price can fall even if underlying rallies. Prefer entries after IV cools or use spreads.',
      tone: ivPercent <= 35 ? 'good' : 'warn',
    });
  } else {
    entries.push({
      key: 'iv',
      label: 'Implied Volatility',
      primary: 'IV snapshot missing.',
      detail: 'Wait for Massive to return IV or avoid entering blind—vol crush risk is real.',
      tone: 'neutral',
    });
  }

  if (typeof theta === 'number') {
    entries.push({
      key: 'theta',
      label: 'Theta Decay',
      primary: `Loses ${theta.toFixed(2)} per day if price stalls.`,
      detail:
        theta > -0.2
          ? 'Time decay is manageable thanks to extra duration.'
          : 'Aggressive theta bleed—intraday only unless you can actively manage risk.',
      tone: theta > -0.2 ? 'good' : 'warn',
    });
  } else {
    entries.push({
      key: 'theta',
      label: 'Theta Decay',
      primary: 'Theta data unavailable.',
      detail: 'Without theta we cannot track daily bleed—confirm the contract before entering.',
      tone: 'neutral',
    });
  }

  if (typeof openInterest === 'number' || typeof spread === 'number') {
    const oi = openInterest ?? 0;
    const spreadText = typeof spread === 'number' ? `$${spread.toFixed(2)}` : 'unknown';
    const tightSpread = typeof spread === 'number' ? spread <= 0.1 : false;
    entries.push({
      key: 'liquidity',
      label: 'Liquidity + Exit',
      primary: `${oi.toLocaleString()} OI · Spread ${spreadText}.`,
      detail: tightSpread
        ? 'Depth looks healthy—fills should be smooth.'
        : 'Wide spreads eat P/L immediately. Use limit orders or switch strikes.',
      tone: oi >= 500 && tightSpread ? 'good' : oi < 200 ? 'alert' : 'warn',
    });
  } else {
    entries.push({
      key: 'liquidity',
      label: 'Liquidity + Exit',
      primary: 'Need OI and bid/ask data.',
      detail: 'Never enter without confirming liquidity—slippage destroys trades.',
      tone: 'alert',
    });
  }

  return entries;
}

function toneToBorder(tone: ChecklistEntry['tone']) {
  switch (tone) {
    case 'good':
      return 'border-emerald-500/40';
    case 'warn':
      return 'border-amber-500/40';
    case 'alert':
      return 'border-red-500/50';
    default:
      return 'border-gray-900';
  }
}

function toneToBackground(tone: ChecklistEntry['tone']) {
  switch (tone) {
    case 'good':
      return 'bg-emerald-500/10';
    case 'warn':
      return 'bg-amber-500/10';
    case 'alert':
      return 'bg-red-500/10';
    default:
      return 'bg-gray-950';
  }
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
  const bid =
    typeof (quote as any).bid === 'number' ? (quote as any).bid : (quote as any).bidPrice ?? (quote as any).bid_price;
  const ask =
    typeof (quote as any).ask === 'number' ? (quote as any).ask : (quote as any).askPrice ?? (quote as any).ask_price;
  if (typeof (quote as any).mid === 'number') return (quote as any).mid;
  if (typeof bid === 'number' && typeof ask === 'number') {
    return (bid + ask) / 2;
  }
  return null;
}

function formatCurrency(value: number) {
  return `$${value.toFixed(2)}`;
}

function resolveSpread(leg?: OptionLeg | null, contract?: OptionContractDetail | null): number | null {
  const legBid = typeof leg?.bid === 'number' ? leg.bid : null;
  const legAsk = typeof leg?.ask === 'number' ? leg.ask : null;
  const quote = contract?.lastQuote as Record<string, unknown> | undefined;
  const quoteBid =
    typeof (quote as any)?.bid === 'number'
      ? (quote as any).bid
      : typeof (quote as any)?.bidPrice === 'number'
      ? (quote as any).bidPrice
      : typeof (quote as any)?.bid_price === 'number'
      ? (quote as any).bid_price
      : null;
  const quoteAsk =
    typeof (quote as any)?.ask === 'number'
      ? (quote as any).ask
      : typeof (quote as any)?.askPrice === 'number'
      ? (quote as any).askPrice
      : typeof (quote as any)?.ask_price === 'number'
      ? (quote as any).ask_price
      : null;
  const bid = legBid ?? quoteBid;
  const ask = legAsk ?? quoteAsk;
  if (typeof bid === 'number' && typeof ask === 'number' && ask >= bid) {
    return ask - bid;
  }
  return null;
}
