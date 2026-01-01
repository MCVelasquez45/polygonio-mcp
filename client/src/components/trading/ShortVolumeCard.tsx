import { useMemo } from 'react';
import { BarChart, Bar, XAxis, Tooltip, Cell } from 'recharts';
import { MeasuredContainer } from '../shared/MeasuredContainer';
import type { ShortVolumeResponse } from '../../api/market';

type Props = {
  payload: ShortVolumeResponse | null;
  loading?: boolean;
  error?: string | null;
  requestedTicker?: string;
};

type ChartPoint = {
  dateLabel: string;
  shortVolume: number;
  totalVolume: number | null;
  ratio: number | null;
};

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function formatDateShort(value: string | null | undefined) {
  if (!value) return '—';
  const parsed = parseDate(value);
  if (!parsed) return value;
  return new Date(parsed).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatCompact(value: number | null, digits = 2) {
  if (value == null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: digits,
  }).format(value);
}

function formatPercent(value: number | null, digits = 2) {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

function resolveBarColor(ratio: number | null) {
  if (ratio == null) return '#38bdf8';
  if (ratio >= 50) return '#f97316';
  if (ratio >= 40) return '#eab308';
  return '#22c55e';
}

function ShortVolumeTooltip({ active, payload, label }: { active?: boolean; payload?: any[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const entry = payload[0]?.payload as ChartPoint | undefined;
  if (!entry) return null;
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-xs text-gray-200">
      <p className="text-gray-400">{label}</p>
      <p>Short Volume: {formatCompact(entry.shortVolume)}</p>
      <p>Total Volume: {formatCompact(entry.totalVolume)}</p>
      <p>Short Ratio: {formatPercent(entry.ratio)}</p>
    </div>
  );
}

export function ShortVolumeCard({ payload, loading, error, requestedTicker }: Props) {
  const results = payload?.results ?? [];
  const sorted = useMemo(() => {
    return [...results].sort((a, b) => {
      const aTime = parseDate(a.date) ?? 0;
      const bTime = parseDate(b.date) ?? 0;
      return aTime - bTime;
    });
  }, [results]);
  const latest = sorted.at(-1);
  const resolvedTicker = payload?.resolvedTicker ?? payload?.ticker ?? requestedTicker ?? '—';
  const chartData: ChartPoint[] = useMemo(() => {
    return sorted.map(entry => ({
      dateLabel: formatDateShort(entry.date),
      shortVolume: entry.shortVolume ?? 0,
      totalVolume: entry.totalVolume ?? null,
      ratio: entry.shortVolumeRatio ?? null,
    }));
  }, [sorted]);
  const averageShortVolume = useMemo(() => {
    const window = sorted.slice(-10);
    const values = window.map(entry => entry.shortVolume).filter((value): value is number => typeof value === 'number');
    if (!values.length) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }, [sorted]);
  const shortVolumeSpike =
    typeof latest?.shortVolume === 'number' &&
    typeof averageShortVolume === 'number' &&
    latest.shortVolume >= averageShortVolume * 2;
  const ratioElevated = typeof latest?.shortVolumeRatio === 'number' && latest.shortVolumeRatio >= 50;
  const alertMessage = shortVolumeSpike
    ? `Short volume spike: ${formatCompact(latest?.shortVolume)} vs ${formatCompact(averageShortVolume)} avg.`
    : ratioElevated
    ? `Short volume ratio elevated (${formatPercent(latest?.shortVolumeRatio)}).`
    : null;

  if (loading) {
    return (
      <section className="border border-gray-900 rounded-2xl p-4 bg-gray-950/60 animate-pulse">
        <p className="text-xs uppercase tracking-[0.4em] text-gray-600">Short Volume</p>
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
          <p className="text-xs uppercase tracking-[0.4em] text-gray-500">Short Volume</p>
          <p className="text-sm text-gray-400">Daily off-exchange activity</p>
        </div>
        <div className="text-xs border border-gray-700/60 bg-gray-900/40 rounded-full px-3 py-1 text-gray-300">
          {latest?.date ? formatDateShort(latest.date) : '—'}
        </div>
      </header>

      {error && (
        <div className="text-xs text-rose-300 border border-rose-500/30 bg-rose-500/10 rounded-xl px-3 py-2">
          {error}
        </div>
      )}

      {alertMessage && (
        <div className="text-xs text-amber-200 border border-amber-500/30 bg-amber-500/10 rounded-xl px-3 py-2">
          {alertMessage}
        </div>
      )}

      {!latest ? (
        <p className="text-sm text-gray-400">Short volume data is unavailable for this ticker.</p>
      ) : (
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div className="rounded-xl border border-gray-900 bg-gray-950/60 p-3">
            <p className="text-xs uppercase tracking-widest text-gray-500">Short Volume</p>
            <p className="text-lg font-semibold text-white mt-1">{formatCompact(latest.shortVolume)}</p>
            <p className="text-xs text-gray-400 mt-1">Reported for {resolvedTicker}</p>
          </div>
          <div className="rounded-xl border border-gray-900 bg-gray-950/60 p-3">
            <p className="text-xs uppercase tracking-widest text-gray-500">Short Ratio</p>
            <p className="text-lg font-semibold text-white mt-1">{formatPercent(latest.shortVolumeRatio)}</p>
            <p className="text-xs text-gray-400 mt-1">Shorts vs total</p>
          </div>
          <div className="rounded-xl border border-gray-900 bg-gray-950/60 p-3">
            <p className="text-xs uppercase tracking-widest text-gray-500">Total Volume</p>
            <p className="text-lg font-semibold text-white mt-1">{formatCompact(latest.totalVolume)}</p>
            <p className="text-xs text-gray-400 mt-1">All venues</p>
          </div>
        </div>
      )}

      {chartData.length > 1 && (
        <MeasuredContainer className="h-40 w-full" minHeight={160}>
          {({ width, height }) => (
            <BarChart width={width} height={height} data={chartData}>
              <XAxis dataKey="dateLabel" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip content={<ShortVolumeTooltip />} cursor={{ fill: 'rgba(148, 163, 184, 0.12)' }} />
              <Bar dataKey="shortVolume" radius={[6, 6, 0, 0]}>
                {chartData.map((entry, index) => (
                  <Cell key={`${entry.dateLabel}-${index}`} fill={resolveBarColor(entry.ratio)} />
                ))}
              </Bar>
            </BarChart>
          )}
        </MeasuredContainer>
      )}
    </section>
  );
}
