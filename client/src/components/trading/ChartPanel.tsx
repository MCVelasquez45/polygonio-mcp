import { AggregateBar, IndicatorBundle } from '../../types/market';
import type { UTCTimestamp, SeriesMarker } from 'lightweight-charts';
import { Lock, TrendingDown, TrendingUp } from 'lucide-react';
import { TradingViewChart } from './TradingViewChart';

type TimeframeOption = {
  label: string;
  value: string;
};

type Props = {
  ticker: string;
  timeframe: string;
  data: AggregateBar[];
  indicators?: IndicatorBundle;
  isLoading: boolean;
  onTimeframeChange: (value: string) => void;
  chartKey?: string;
  sessionMode?: 'regular' | 'extended';
  onSessionModeChange?: (value: 'regular' | 'extended') => void;
  onRunAnalysis?: () => void;
  analysis?: {
    headline: string;
    bullets: string[];
  } | null;
  analysisLoading?: boolean;
  analysisError?: string | null;
  analysisUpdatedAt?: number | null;
  analysisDisabled?: boolean;
  fallbackPrice?: number | null;
  fallbackChange?: { absolute: number | null; percent: number | null };
  sessionMeta?: {
    marketClosed?: boolean;
    afterHours?: boolean;
    usingLastSession?: boolean;
    resultGranularity?: 'intraday' | 'daily' | 'cache';
    note?: string | null;
    state?: string;
    nextOpen?: string | null;
    health?: {
      mode: 'LIVE' | 'DEGRADED' | 'BACKFILLING' | 'FROZEN';
      source: 'rest' | 'cache' | 'snapshot' | 'ws';
      lastUpdateMsAgo: number | null;
      providerThrottled: boolean;
      gapsDetected: number;
    } | null;
  } | null;
  markers?: SeriesMarker<UTCTimestamp>[];
};

const TIMEFRAMES: TimeframeOption[] = [
  { label: '1M', value: '1/minute' },
  { label: '3M', value: '3/minute' },
  { label: '5M', value: '5/minute' },
  { label: '15M', value: '15/minute' },
  { label: '30M', value: '30/minute' },
  { label: '1H', value: '1/hour' },
  { label: '1D', value: '1/day' },
];

function formatAge(msAgo: number | null) {
  if (msAgo == null || Number.isNaN(msAgo)) return null;
  if (msAgo < 1_000) return 'just now';
  const seconds = Math.floor(msAgo / 1_000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function joinDetails(parts: Array<string | null | undefined>) {
  const filtered = parts.filter((part): part is string => Boolean(part));
  return filtered.length ? filtered.join(' · ') : null;
}

export function ChartPanel({
  ticker,
  timeframe,
  data,
  indicators,
  isLoading,
  onTimeframeChange,
  chartKey,
  sessionMode,
  onSessionModeChange,
  onRunAnalysis,
  analysis,
  analysisLoading,
  analysisError,
  analysisUpdatedAt,
  analysisDisabled,
  fallbackPrice,
  fallbackChange,
  sessionMeta,
  markers,
}: Props) {
  const currentPrice = data.at(-1)?.close ?? null;
  const openPrice = data.at(0)?.close ?? null;
  const change = currentPrice != null && openPrice != null ? currentPrice - openPrice : null;
  const changePercent = change != null && openPrice ? (change / openPrice) * 100 : null;
  const displayPrice = fallbackPrice ?? currentPrice ?? null;
  const displayChange = fallbackChange?.absolute ?? change ?? null;
  const displayChangePercent = fallbackChange?.percent ?? changePercent ?? null;
  const isMarketClosed = sessionMeta?.marketClosed ?? false;
  const usingLastSession = sessionMeta?.usingLastSession ?? false;
  const resultGranularity = sessionMeta?.resultGranularity ?? 'intraday';
  const health = sessionMeta?.health ?? null;
  const healthAge = formatAge(health?.lastUpdateMsAgo ?? null);
  const isStale = (health?.lastUpdateMsAgo ?? 0) > 10 * 60 * 1000;
  const isFrozen = health?.mode === 'FROZEN' || isMarketClosed;
  const healthLabel =
    isFrozen
      ? 'Frozen'
      : health?.mode === 'BACKFILLING'
        ? 'Backfilling'
        : health?.mode === 'LIVE' && isStale
          ? 'Stale'
          : health?.mode === 'LIVE'
            ? 'Live'
            : health?.source === 'snapshot'
              ? 'Snapshot'
              : health?.source === 'cache'
                ? 'Cached'
                : 'Degraded';
  const healthDetail = joinDetails([
    healthAge ? `Last update ${healthAge}` : null,
    health?.providerThrottled ? 'Rate limited' : null,
    health?.gapsDetected ? `${health.gapsDetected} gap${health.gapsDetected === 1 ? '' : 's'}` : null,
  ]);
  const healthTone =
    healthLabel === 'Live'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
      : healthLabel === 'Backfilling' || healthLabel === 'Stale'
        ? 'border-amber-500/40 bg-amber-500/10 text-amber-100'
        : 'border-gray-800 bg-gray-900/60 text-gray-300';
  const analysisUpdatedLabel = analysisUpdatedAt ? new Date(analysisUpdatedAt).toLocaleTimeString() : null;
  const emptyStateMessage = ticker.startsWith('O:')
    ? 'Select a contract to load chart data.'
    : 'No chart data available for this symbol.';
  const displayEmptyMessage = sessionMeta?.note ?? emptyStateMessage;
  const timeframeUnit = timeframe.split('/')[1] ?? 'day';
  const isIntraday = timeframeUnit === 'minute' || timeframeUnit === 'hour';
  const hasRenderableData = data.length > 0 && (!isIntraday || data.length >= 2);

  const chartInstanceKey = chartKey ? `${chartKey}-${timeframe}` : timeframe;

  return (
    <section className="bg-gray-950/70 border border-gray-900/80 backdrop-blur-sm rounded-2xl p-4 flex flex-col gap-3 min-h-[32rem] lg:min-h-[36rem] min-w-0">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.4em] text-gray-500">{ticker}</p>
          <div className="flex items-center gap-3 text-3xl font-semibold">
            <span>{displayPrice != null ? `$${displayPrice.toFixed(2)}` : '--'}</span>
            {displayChange != null && displayChangePercent != null && (
              <span
                className={`flex items-center gap-2 text-lg ${displayChange >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}
              >
                {displayChange >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
                {displayChange >= 0 ? '+' : ''}
                {displayChange.toFixed(2)} ({displayChangePercent.toFixed(2)}%)
              </span>
            )}
            {isFrozen && (
              <span className="inline-flex items-center gap-1 text-xs text-amber-200 border border-amber-500/30 bg-amber-500/10 rounded-full px-3 py-1">
                <Lock className="h-3 w-3" /> Frozen
              </span>
            )}
            {health && !isFrozen && (
              <span className={`inline-flex items-center gap-2 text-xs rounded-full border px-3 py-1 ${healthTone}`}>
                {healthLabel}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500">Option aggregates pulled directly from Massive</p>
          {healthDetail && <p className="text-[11px] text-gray-500">{healthDetail}</p>}
          {usingLastSession && (
            <p className="text-[11px] text-amber-200/80 flex items-center gap-1">
              Last session {resultGranularity === 'daily' ? 'daily' : 'intraday'} candles
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 max-w-full w-full md:w-auto justify-start md:justify-end">
          {sessionMode && onSessionModeChange && (
            <div className="flex items-center gap-1 rounded-full border border-gray-900 bg-gray-950/60 p-1 text-xs">
              <button
                type="button"
                onClick={() => onSessionModeChange('regular')}
                className={`px-3 py-1 rounded-full ${sessionMode === 'regular' ? 'bg-emerald-500/20 text-white' : 'text-gray-400'
                  }`}
              >
                RTH
              </button>
              <button
                type="button"
                onClick={() => onSessionModeChange('extended')}
                className={`px-3 py-1 rounded-full ${sessionMode === 'extended' ? 'bg-emerald-500/20 text-white' : 'text-gray-400'
                  }`}
              >
                EXT
              </button>
            </div>
          )}
          {onRunAnalysis && (
            <button
              type="button"
              onClick={onRunAnalysis}
              disabled={analysisLoading || analysisDisabled}
              className="px-3 py-1.5 text-xs rounded-full border border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/10 disabled:opacity-60"
            >
              {analysisLoading ? 'Analyzing…' : 'Run 5-min analysis'}
            </button>
          )}
          {TIMEFRAMES.map(option => (
            <button
              key={option.value}
              type="button"
              onClick={() => onTimeframeChange(option.value)}
              className={`px-3 py-1.5 text-xs rounded-full border ${timeframe === option.value ? 'bg-emerald-500/20 border-emerald-400 text-white' : 'border-gray-800 text-gray-400'
                }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      <div className="relative flex-1 min-h-[300px]">
        {!hasRenderableData ? (
          <div className="h-full flex items-center justify-center text-gray-500 text-sm text-center px-4">
            {isLoading ? 'Loading bars…' : displayEmptyMessage}
          </div>
        ) : (
          <TradingViewChart key={chartInstanceKey} bars={data} timeframe={timeframe} markers={markers} />
        )}
        {isLoading && data.length > 0 && (
          <div className="absolute inset-0 pointer-events-none flex items-start justify-end p-3">
            <span className="rounded-full border border-gray-800 bg-gray-950/80 px-3 py-1 text-[11px] text-gray-300">
              Updating…
            </span>
          </div>
        )}
      </div>
      {(analysis || analysisError || analysisLoading) && (
        <div className="rounded-2xl border border-gray-900 bg-gray-950/60 p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-gray-500">5-Minute Candle Analysis</p>
              {analysisUpdatedLabel && (
                <p className="text-[11px] text-gray-500">Last run {analysisUpdatedLabel}</p>
              )}
            </div>
          </div>
          {analysisLoading && <p className="text-xs text-gray-400">Building the opening-range read…</p>}
          {!analysisLoading && analysisError && <p className="text-xs text-amber-200">{analysisError}</p>}
          {!analysisLoading && analysis && (
            <div className="space-y-2 text-sm text-gray-200">
              <p className="font-semibold text-white">{analysis.headline}</p>
              <ul className="space-y-1 text-xs text-gray-300">
                {analysis.bullets.map(item => (
                  <li key={item} className="flex items-start gap-2">
                    <span className="text-emerald-300">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {sessionMeta?.note && <p className="text-[11px] text-gray-500">{sessionMeta.note}</p>}
    </section>
  );
}
