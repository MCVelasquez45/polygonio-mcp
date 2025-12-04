import { useMemo, useState } from 'react';
import type { ChecklistResult, ChecklistCategory } from '../../api/analysis';

const gradeColors: Record<string, string> = {
  'A+': 'text-emerald-300 border-emerald-500/40 bg-emerald-500/5',
  A: 'text-emerald-200 border-emerald-500/20 bg-emerald-500/5',
  B: 'text-amber-200 border-amber-500/30 bg-amber-500/5',
  C: 'text-rose-200 border-red-500/30 bg-red-500/5'
};

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  trend: 'Trend structure (EMAs, VWAP, higher highs)',
  momentum: 'Momentum (RSI, MACD, volume)',
  liquidity: 'Options liquidity (spread, OI, delta window)',
  market: 'Market context (SPY, QQQ, VIX alignment)',
  levels: 'Support/resistance padding',
  volumeProfile: 'Volume profile & VWAP placement',
  entry: 'Entry trigger confirmation',
  risk: 'Risk/reward + stop placement'
};

type Props = {
  result: ChecklistResult | null;
  loading?: boolean;
};

function describeCategory(category: ChecklistCategory) {
  const label = CATEGORY_DESCRIPTIONS[category.key] ?? category.label;
  if (category.score === category.max) {
    return { tone: 'good', text: `${label} locked in.` };
  }
  if (category.score === 0) {
    return { tone: 'warn', text: `${label} missing — wait for cleaner structure.` };
  }
  return { tone: 'neutral', text: `${label} improving but not perfect yet.` };
}

export function EntryChecklistPanel({ result, loading }: Props) {
  const [showDetails, setShowDetails] = useState(false);
  const categoryCallouts = useMemo(() => {
    if (!result?.categories) return [];
    return result.categories.map(describeCategory);
  }, [result]);
  const failingCategories = useMemo(() => {
    if (!result?.categories) return [];
    return result.categories
      .filter(category => category.score < category.max)
      .sort((a, b) => a.score / a.max - b.score / b.max)
      .slice(0, 3);
  }, [result]);
  const topSignals = useMemo(() => {
    if (!result?.categories) return [];
    return result.categories.filter(category => category.score === category.max).slice(0, 3);
  }, [result]);

  if (loading) {
    return (
      <div className="border border-gray-900 rounded-2xl p-4 animate-pulse bg-gray-950/60">
        <p className="text-xs uppercase tracking-[0.3em] text-gray-600">Entry Checklist</p>
        <div className="h-8 w-24 bg-gray-800 rounded mt-3" />
        <div className="h-3 bg-gray-800 rounded mt-4" />
        <div className="h-3 bg-gray-800 rounded mt-2" />
      </div>
    );
  }

  if (!result) {
    return (
      <div className="border border-gray-900 rounded-2xl p-4 bg-gray-950">
        <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Entry Checklist</p>
        <p className="text-sm text-gray-400 mt-2">
          Select a ticker to run the professional entry checklist.
        </p>
      </div>
    );
  }

  const percent = result.maxScore ? Math.round((result.totalScore / result.maxScore) * 100) : 0;
  const gradeClass = gradeColors[result.grade] ?? 'text-gray-200 border-gray-800 bg-gray-900/60';

  return (
    <section className="border border-gray-900 rounded-2xl p-4 bg-gray-950 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-gray-500">Entry Checklist</p>
          <p className="text-sm text-gray-300">
            {result.qualifies ? 'High-ROI setup confirmed' : 'Waiting on stronger confirmation'}
          </p>
        </div>
        <div className={`rounded-2xl border px-4 py-2 text-center ${gradeClass}`}>
          <p className="text-xs uppercase tracking-[0.3em]">Grade</p>
          <p className="text-2xl font-semibold">{result.grade}</p>
          <p className="text-[11px]">{percent}% score</p>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-gray-400">
        <div>
          <p className="uppercase tracking-wide text-gray-500">Price</p>
          <p className="text-sm text-white">{result.price != null ? `$${result.price.toFixed(2)}` : '—'}</p>
        </div>
        <div>
          <p className="uppercase tracking-wide text-gray-500">Support</p>
          <p className="text-sm text-white">{result.support != null ? `$${result.support.toFixed(2)}` : '—'}</p>
        </div>
        <div>
          <p className="uppercase tracking-wide text-gray-500">Resistance</p>
          <p className="text-sm text-white">{result.resistance != null ? `$${result.resistance.toFixed(2)}` : '—'}</p>
        </div>
        <div>
          <p className="uppercase tracking-wide text-gray-500">Delta</p>
          <p className="text-sm text-white">
            {result.optionMetrics?.delta != null ? result.optionMetrics.delta.toFixed(2) : '—'}
          </p>
        </div>
      </div>
      <div className="border border-gray-900 rounded-xl p-3 bg-gray-950/60 text-xs text-gray-300 space-y-2">
        <p className="uppercase tracking-[0.3em] text-gray-500 text-[11px]">Quick read</p>
        <div className="space-y-1">
          {categoryCallouts.slice(0, 3).map(callout => (
            <p
              key={callout.text}
              className={
                callout.tone === 'good'
                  ? 'text-emerald-200'
                  : callout.tone === 'warn'
                  ? 'text-amber-200'
                  : 'text-gray-300'
              }
            >
              {callout.text}
            </p>
          ))}
        </div>
        {failingCategories.length > 0 && (
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] text-gray-500">What to fix</p>
            <ul className="mt-1 space-y-1">
              {failingCategories.map(category => (
                <li key={category.key} className="flex items-center gap-2 text-amber-100">
                  <span className="text-base leading-none">!</span>
                  <span>
                    {CATEGORY_DESCRIPTIONS[category.key] ?? category.label} ({category.score}/{category.max})
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {topSignals.length > 0 && (
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] text-gray-500">What’s working</p>
            <ul className="mt-1 space-y-1">
              {topSignals.map(category => (
                <li key={category.key} className="flex items-center gap-2 text-emerald-200">
                  <span className="text-base leading-none">✔</span>
                  <span>{CATEGORY_DESCRIPTIONS[category.key] ?? category.label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <button
          type="button"
          onClick={() => setShowDetails(prev => !prev)}
          className="inline-flex items-center gap-2 text-xs text-gray-300 border border-gray-800 rounded-full px-3 py-1 hover:border-emerald-500/40 hover:text-white transition-colors"
        >
          {showDetails ? 'Hide full checklist' : 'View full checklist'}
        </button>
      </div>
      {showDetails && (
        <div className="space-y-3">
          {(result.categories ?? []).map(category => {
          const categoryPercent = category.max ? Math.round((category.score / category.max) * 100) : 0;
          return (
            <div key={category.key} className="border border-gray-900 rounded-xl p-3 bg-gray-950/40">
              <div className="flex items-center justify-between text-sm text-gray-200">
                <p>{category.label}</p>
                <span className="text-xs text-gray-400">{category.score}/{category.max}</span>
              </div>
              <div className="h-1.5 bg-gray-900 rounded-full mt-2 overflow-hidden">
                <div
                  className={`h-full rounded-full ${categoryPercent >= 75 ? 'bg-emerald-400' : categoryPercent >= 50 ? 'bg-amber-400' : 'bg-red-400'}`}
                  style={{ width: `${categoryPercent}%` }}
                />
              </div>
              <ul className="mt-3 space-y-1 text-xs text-gray-400">
                {category.items.map(item => (
                  <li key={item.label} className="flex items-start gap-2">
                    <span className={`text-[11px] leading-5 ${item.passed ? 'text-emerald-300' : 'text-amber-300'}`}>
                      {item.passed ? '✔' : '!'}
                    </span>
                    <span className={item.passed ? 'text-gray-200' : 'text-gray-400'}>{item.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        </div>
      )}
      {result.sentiment && (
        <div className="text-xs text-gray-400">
          Massive Sentiment:{' '}
          <span
            className={
              result.sentiment.score != null && result.sentiment.score < 0
                ? 'text-red-300'
                : result.sentiment.score != null && result.sentiment.score > 0
                ? 'text-emerald-300'
                : 'text-gray-200'
            }
          >
            {result.sentiment.label ?? 'neutral'}
            {result.sentiment.score != null ? ` (${Number(result.sentiment.score).toFixed(2)})` : ''}
          </span>
        </div>
      )}
      {result.fedEvent && (
        <div className="text-xs text-amber-300">
          Upcoming event: {result.fedEvent.name ?? result.fedEvent.title} · {result.fedEvent.date}
        </div>
      )}
    </section>
  );
}
