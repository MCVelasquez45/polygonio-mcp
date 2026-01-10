import { useEffect, useMemo, useRef, useState } from 'react';
import type { OptionContractDetail, OptionLeg } from '../../types/market';
import { analysisApi } from '../../api';
import type { ContractExplanationResult, ContractSelectionResult, DeskInsight } from '../../api/analysis';
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
  insight?: DeskInsight | null;
  selection?: ContractSelectionResult | null;
  selectionLoading?: boolean;
  onRequestSelection?: () => void;
  analysisRequestId?: number;
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

function isAbortError(error: any): boolean {
  return error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError' || error?.name === 'AbortError';
}

export function GreeksPanel({
  contract,
  leg,
  label,
  underlyingPrice,
  insight,
  selection,
  selectionLoading,
  onRequestSelection,
  analysisRequestId
}: Props) {
  const displayName = label ?? contract?.ticker ?? leg?.ticker ?? 'Select a contract';
  const contractSymbol = contract?.ticker ?? leg?.ticker ?? null;
  const underlyingSymbol = contract?.underlying ?? leg?.underlying ?? null;
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
  const contractMeta = [
    { label: 'Expiration', value: resolvedExpiration ? formatExpirationDate(resolvedExpiration) : '—' },
    { label: 'Strike', value: resolvedStrike != null ? `$${resolvedStrike.toFixed(2)}` : '—' },
    { label: 'Premium', value: resolvedPremium != null ? `$${resolvedPremium.toFixed(2)}` : '—' },
    {
      label: 'Delta',
      value: typeof resolvedGreeks.delta === 'number' ? resolvedGreeks.delta.toFixed(2) : '—'
    }
  ];
  const riskProfile = buildRiskProfile(resolvedGreeks, {
    iv: resolvedIV,
    openInterest: resolvedOpenInterest,
    volume: resolvedVolume,
  });
  const totalRiskValue = riskProfile.slices.reduce((sum, slice) => sum + slice.value, 0) || 1;
  const spread = resolveSpread(leg, contract);
  const itmProbability = typeof resolvedGreeks.delta === 'number' ? Math.abs(resolvedGreeks.delta) * 100 : null;
  const [showTechnical, setShowTechnical] = useState(false);
  const [explanation, setExplanation] = useState<ContractExplanationResult | null>(null);
  const [explanationLoading, setExplanationLoading] = useState(false);
  const [explanationError, setExplanationError] = useState<string | null>(null);
  const analysisRequestRef = useRef(0);

  const ivPercent = typeof resolvedIV === 'number' ? resolvedIV * 100 : null;
  const ivLabel =
    ivPercent == null
      ? null
      : ivPercent <= 35
      ? 'efficient'
      : ivPercent <= 70
      ? 'elevated'
      : 'extreme';
  const spreadLabel =
    typeof spread === 'number'
      ? spread <= 0.1
        ? `Spread $${spread.toFixed(2)} (tight)`
        : spread <= 0.3
        ? `Spread $${spread.toFixed(2)} (ok)`
        : `Spread $${spread.toFixed(2)} (wide)`
      : null;
  const oiLabel =
    typeof resolvedOpenInterest === 'number' ? `OI ${resolvedOpenInterest.toLocaleString()}` : null;
  const selectionWarnings = useMemo(() => selection?.warnings?.filter(Boolean) ?? [], [selection?.warnings]);
  const overviewBadges = [
    ivPercent != null ? `IV ${ivLabel ?? ''}${ivLabel ? ' · ' : ''}${ivPercent.toFixed(1)}%` : null,
    oiLabel,
    spreadLabel
  ].filter(Boolean);
  const spotLabel =
    typeof underlyingPrice === 'number' ? `$${underlyingPrice.toFixed(2)}` : null;
  const breakevenLabel =
    breakevenPrice != null ? `$${breakevenPrice.toFixed(2)}` : null;
  const breakevenDeltaLabel =
    breakevenPercent != null ? `${breakevenPercent >= 0 ? '+' : ''}${breakevenPercent.toFixed(2)}%` : null;
  const spotLine =
    spotLabel && breakevenLabel
      ? `Spot ${spotLabel} → Breakeven ${breakevenLabel}${breakevenDeltaLabel ? ` (${breakevenDeltaLabel})` : ''}`
      : 'Breakeven distance unavailable.';
  const underlyingName = useMemo(() => {
    const raw = (label ?? underlyingSymbol ?? insight?.symbol ?? contractSymbol ?? 'Underlying').toUpperCase();
    return raw.startsWith('O:') ? raw.slice(2) : raw;
  }, [label, underlyingSymbol, insight?.symbol, contractSymbol]);
  const fallbackUsed =
    selection?.source === 'fallback' || selectionWarnings.some(item => item.toLowerCase().includes('fallback'));
  const decision = useMemo(
    () => ({
      selectedContract: selection?.selectedContract ?? contractSymbol,
      side: selection?.side ?? (contractType === 'call' ? 'call' : contractType === 'put' ? 'put' : null),
      confidence: selection?.confidence ?? null,
      reasons: selection?.reasons ?? [],
      warnings: selection?.warnings ?? [],
      source: selection?.source ?? 'fallback',
      fallbackUsed,
      constraintsFailed: selectionWarnings
    }),
    [selection, contractSymbol, contractType, fallbackUsed, selectionWarnings]
  );
  const explanationPayload = useMemo(() => {
    if (!contractSymbol || !contractType) return null;
    if (contractType !== 'call' && contractType !== 'put') return null;
    return {
      underlying: underlyingName,
      spotPrice: typeof underlyingPrice === 'number' ? underlyingPrice : null,
      breakeven: breakevenPrice ?? null,
      breakevenPct: breakevenPercent ?? null,
      contract: {
        symbol: contractSymbol,
        type: contractType,
        strike: resolvedStrike ?? null,
        expiration: resolvedExpiration ?? null,
        price: resolvedPremium ?? null
      },
      decision,
      risk: {
        score: riskProfile.score ?? null,
        label: riskProfile.label ?? null
      }
    };
  }, [
    contractSymbol,
    contractType,
    underlyingName,
    resolvedStrike,
    resolvedExpiration,
    resolvedPremium,
    breakevenPrice,
    breakevenPercent,
    underlyingPrice,
    decision,
    riskProfile.score,
    riskProfile.label
  ]);
  const riskLevelLine =
    explanation?.riskLevel ??
    (riskProfile.label ? `${riskProfile.label}${riskProfile.score != null ? ` — ${Math.round(riskProfile.score * 100)}%` : ''}` : null);

  useEffect(() => {
    setExplanation(null);
    setExplanationError(null);
    setExplanationLoading(false);
  }, [contractSymbol, resolvedStrike, resolvedExpiration, contractType]);

  useEffect(() => {
    if (!analysisRequestId) return;
    if (analysisRequestRef.current === analysisRequestId) return;
    analysisRequestRef.current = analysisRequestId;
    if (!explanationPayload) {
      setExplanation(null);
      setExplanationError('Select a contract to analyze.');
      setExplanationLoading(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setExplanation(null);
    setExplanationLoading(true);
    setExplanationError(null);
    analysisApi
      .getContractExplanation(explanationPayload, controller.signal)
      .then(result => {
        if (!cancelled) setExplanation(result);
      })
      .catch(error => {
        if (cancelled || isAbortError(error)) return;
        if (error?.response?.status === 429) {
          const retryAfterMs = error?.response?.data?.retryAfterMs;
          const retryLabel =
            typeof retryAfterMs === 'number' && retryAfterMs > 0
              ? ` Try again in ${Math.ceil(retryAfterMs / 1000)}s.`
              : '';
          setExplanation(null);
          setExplanationError(`AI request limit reached.${retryLabel}`);
          return;
        }
        setExplanation(null);
        setExplanationError('Unable to generate an explanation yet.');
      })
      .finally(() => {
        if (!cancelled) setExplanationLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [analysisRequestId, explanationPayload]);
  const showExplanationPlaceholder = explanationLoading && !explanation && !explanationError;

  return (
    <section className="bg-gray-950 border border-gray-900 rounded-2xl p-4 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-gray-500">Greeks + Risk</p>
          <p className="text-lg font-semibold text-gray-100">{displayName}</p>
        </div>
        <div className="flex items-center gap-2">
          {onRequestSelection && (
            <button
              type="button"
              onClick={onRequestSelection}
              disabled={selectionLoading}
              className="px-3 py-1 text-xs rounded-full border border-gray-800 text-gray-300 hover:border-emerald-500/40 hover:text-white disabled:opacity-60"
            >
              AI Select
            </button>
          )}
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
        </div>
      </header>

      <div className="border border-gray-900 rounded-2xl p-4 bg-gray-950 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.4em] text-gray-500">Beginner View</p>
          <button
            type="button"
            onClick={() => setShowTechnical(open => !open)}
            className="text-xs text-gray-400 border border-gray-800 rounded-full px-3 py-1 hover:border-emerald-500/40 hover:text-white transition-colors"
          >
            {showTechnical ? 'Hide technical details' : 'Show technical details'}
          </button>
        </div>
        {selectionLoading && <p className="text-xs text-gray-500">Picking the best contract…</p>}
        {(explanationLoading || showExplanationPlaceholder) && (
          <p className="text-xs text-gray-500">Building an explanation…</p>
        )}
        {!explanationLoading && explanationError && <p className="text-xs text-amber-200">{explanationError}</p>}
        {!explanationLoading && explanation ? (
          <div className="space-y-3 text-sm text-gray-200">
            <div>
              <p className="text-[11px] uppercase tracking-[0.3em] text-gray-500">What this trade does</p>
              <p className="text-gray-200 mt-1">{explanation.whatThisTradeDoes}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.3em] text-gray-500">What needs to happen</p>
              {explanation.whatNeedsToHappen.length ? (
                <ul className="mt-1 space-y-1 text-xs text-gray-400">
                  {explanation.whatNeedsToHappen.map(item => (
                    <li key={item} className="flex items-start gap-2">
                      <span className="text-emerald-300">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-gray-500">Waiting on more market data.</p>
              )}
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.3em] text-gray-500">Main risks</p>
              {explanation.mainRisks.length ? (
                <ul className="mt-1 space-y-1 text-xs text-amber-200">
                  {explanation.mainRisks.map(item => (
                    <li key={item} className="flex items-start gap-2">
                      <span className="text-amber-200">!</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-gray-500">No major risks flagged yet.</p>
              )}
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.3em] text-gray-500">Why the AI picked this</p>
              {explanation.whyAIChoseThis.length ? (
                <ul className="mt-1 space-y-1 text-xs text-gray-400">
                  {explanation.whyAIChoseThis.map(item => (
                    <li key={item} className="flex items-start gap-2">
                      <span className="text-emerald-300">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-gray-500">No selection rationale available yet.</p>
              )}
            </div>
            {riskLevelLine && (
              <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-3 py-2 text-xs text-gray-300">
                Risk level: <span className="text-gray-100">{riskLevelLine}</span>
              </div>
            )}
          </div>
        ) : (
          !explanationLoading && !explanationError && (
            <p className="text-xs text-gray-500">Select a contract and run “Analyze with AI” to generate an explanation.</p>
          )
        )}
      </div>

      {showTechnical && (
        <div className="space-y-4">
          <div className="border border-gray-900 rounded-2xl p-4 bg-gray-950 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.4em] text-gray-500">Contract Overview</p>
                <p className="text-sm text-gray-300 mt-1">{spotLine}</p>
              </div>
              {overviewBadges.length > 0 && (
                <div className="flex flex-wrap gap-2 text-[11px] text-gray-300">
                  {overviewBadges.map(badge => (
                    <span
                      key={badge}
                      className="px-2 py-1 rounded-full border border-gray-800 bg-gray-900/60"
                    >
                      {badge}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              {contractMeta.map(item => (
                <div key={item.label} className="rounded-2xl border border-gray-900 bg-gray-950 p-3">
                  <p className="text-xs uppercase tracking-widest text-gray-500">{item.label}</p>
                  <p className="text-base font-semibold text-white mt-1">{item.value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="border border-gray-900 rounded-2xl p-4 bg-gray-950 space-y-3">
            <p className="text-xs uppercase tracking-[0.4em] text-gray-500">Greek Snapshot</p>
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
        </div>
      )}
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
