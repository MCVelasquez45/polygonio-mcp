import { useMemo } from 'react';
import type { ShortInterestResponse } from '../../api/market';

type Props = {
  payload: ShortInterestResponse | null;
  loading?: boolean;
  error?: string | null;
  requestedTicker?: string;
};

type ShortInterestTrend = 'higher' | 'lower' | 'flat' | 'unknown';

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function formatDateLabel(value: string | null | undefined) {
  if (!value) return '—';
  const parsed = parseDate(value);
  if (!parsed) return value;
  return new Date(parsed).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatCompact(value: number | null, digits = 2) {
  if (value == null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: digits,
  }).format(value);
}

function formatNumber(value: number | null, digits = 2) {
  if (value == null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function resolveTrend(current: number | null, previous: number | null): ShortInterestTrend {
  if (typeof current !== 'number' || typeof previous !== 'number') return 'unknown';
  if (current > previous) return 'higher';
  if (current < previous) return 'lower';
  return 'flat';
}

function trendStyles(trend: ShortInterestTrend) {
  if (trend === 'higher') return 'text-rose-300 border-rose-500/30 bg-rose-500/10';
  if (trend === 'lower') return 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10';
  return 'text-gray-300 border-gray-700/60 bg-gray-900/40';
}

export function ShortInterestCard({ payload, loading, error, requestedTicker }: Props) {
  const results = payload?.results ?? [];
  const sorted = useMemo(() => {
    return [...results].sort((a, b) => {
      const aTime = parseDate(a.settlementDate) ?? 0;
      const bTime = parseDate(b.settlementDate) ?? 0;
      return bTime - aTime;
    });
  }, [results]);
  const latest = sorted[0];
  const previous = sorted[1];
  const resolvedTicker = payload?.resolvedTicker ?? payload?.ticker ?? requestedTicker ?? '—';
  const trend = resolveTrend(latest?.shortInterest ?? null, previous?.shortInterest ?? null);
  const shortInterestDelta =
    typeof latest?.shortInterest === 'number' && typeof previous?.shortInterest === 'number'
      ? latest.shortInterest - previous.shortInterest
      : null;
  const shortInterestDeltaPct =
    shortInterestDelta != null && typeof previous?.shortInterest === 'number' && previous.shortInterest !== 0
      ? (shortInterestDelta / previous.shortInterest) * 100
      : null;
  const deltaLabel =
    shortInterestDelta != null
      ? `${shortInterestDelta >= 0 ? '+' : ''}${formatCompact(shortInterestDelta)}${shortInterestDeltaPct != null ? ` (${shortInterestDeltaPct.toFixed(2)}%)` : ''}`
      : '—';

  if (loading) {
    return (
      <section className="border border-gray-900 rounded-2xl p-4 bg-gray-950/60 animate-pulse">
        <p className="text-xs uppercase tracking-[0.4em] text-gray-600">Short Interest</p>
        <div className="h-7 w-24 bg-gray-800 rounded mt-3" />
        <div className="h-3 bg-gray-800 rounded mt-4" />
        <div className="h-3 bg-gray-800 rounded mt-2" />
      </section>
    );
  }

  return (
    <section className="border border-gray-900 rounded-2xl p-4 bg-gray-950 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-gray-500">Short Interest</p>
          <p className="text-sm text-gray-400">FINRA bi-monthly reports</p>
        </div>
        <div className={`text-xs border rounded-full px-3 py-1 ${trendStyles(trend)}`}>
          {latest?.settlementDate ? formatDateLabel(latest.settlementDate) : '—'}
        </div>
      </header>

      {error && (
        <div className="text-xs text-rose-300 border border-rose-500/30 bg-rose-500/10 rounded-xl px-3 py-2">
          {error}
        </div>
      )}

      {!latest ? (
        <p className="text-sm text-gray-400">Short interest data is unavailable for this ticker.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl border border-gray-900 bg-gray-950/60 p-3">
            <p className="text-xs uppercase tracking-widest text-gray-500">Short Interest</p>
            <p className="text-lg font-semibold text-white mt-1">{formatCompact(latest.shortInterest)}</p>
            <p className={`text-xs mt-1 ${trend === 'higher' ? 'text-rose-300' : trend === 'lower' ? 'text-emerald-300' : 'text-gray-400'}`}>
              {deltaLabel} vs prev
            </p>
          </div>
          <div className="rounded-xl border border-gray-900 bg-gray-950/60 p-3">
            <p className="text-xs uppercase tracking-widest text-gray-500">Days to Cover</p>
            <p className="text-lg font-semibold text-white mt-1">{formatNumber(latest.daysToCover, 2)}</p>
            <p className="text-xs text-gray-400 mt-1">Avg volume coverage</p>
          </div>
          <div className="rounded-xl border border-gray-900 bg-gray-950/60 p-3">
            <p className="text-xs uppercase tracking-widest text-gray-500">Avg Daily Volume</p>
            <p className="text-lg font-semibold text-white mt-1">{formatCompact(latest.avgDailyVolume)}</p>
            <p className="text-xs text-gray-400 mt-1">Reported window</p>
          </div>
          <div className="rounded-xl border border-gray-900 bg-gray-950/60 p-3">
            <p className="text-xs uppercase tracking-widest text-gray-500">Ticker</p>
            <p className="text-lg font-semibold text-white mt-1">{resolvedTicker}</p>
            {requestedTicker && requestedTicker !== resolvedTicker && (
              <p className="text-xs text-gray-400 mt-1">Requested {requestedTicker}</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
