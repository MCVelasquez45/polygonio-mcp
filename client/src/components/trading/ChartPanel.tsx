import { memo, useEffect, useState } from 'react';
import { AggregateBar, IndicatorBundle } from '../../types/market';
import type { UTCTimestamp, SeriesMarker } from 'lightweight-charts';
import { Lock, TrendingDown, TrendingUp } from 'lucide-react';
import {
  DEFAULT_INDICATOR_TOGGLES,
  TradingViewChart,
  type IndicatorToggles,
} from './TradingViewChart';

const INDICATOR_STORAGE_KEY = 'market-copilot.chartIndicators';

const INDICATOR_CHIPS: Array<{ key: keyof IndicatorToggles; label: string; title: string; intradayOnly?: boolean }> = [
  { key: 'sma', label: 'SMA', title: 'Simple moving average (20)' },
  { key: 'ema', label: 'EMA', title: 'Exponential moving averages (9 / 21)' },
  { key: 'vwap', label: 'VWAP', title: 'Session volume-weighted average price (intraday)', intradayOnly: true },
  { key: 'bollinger', label: 'BB', title: 'Bollinger bands (20, 2σ)' },
  { key: 'rsi', label: 'RSI', title: 'Relative strength index (14) — separate pane' },
  { key: 'macd', label: 'MACD', title: 'MACD (12/26/9) — separate pane' },
];

function readStoredToggles(): IndicatorToggles {
  if (typeof window === 'undefined') return DEFAULT_INDICATOR_TOGGLES;
  try {
    const raw = window.localStorage.getItem(INDICATOR_STORAGE_KEY);
    if (!raw) return DEFAULT_INDICATOR_TOGGLES;
    const parsed = JSON.parse(raw) as Partial<IndicatorToggles>;
    return { ...DEFAULT_INDICATOR_TOGGLES, ...parsed };
  } catch {
    return DEFAULT_INDICATOR_TOGGLES;
  }
}

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

// memo: the chart chrome recomputes ~30 derived values per render; only bar
// data and its own controls should trigger that, not unrelated app renders.
export const ChartPanel = memo(function ChartPanel({
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
      ? 'text-intel-pos'
      : healthLabel === 'Backfilling' || healthLabel === 'Stale'
        ? 'text-intel-warn'
        : 'text-intel-ink2';
  const healthDot =
    healthLabel === 'Live'
      ? 'bg-intel-pos motion-safe:animate-livering'
      : healthLabel === 'Backfilling' || healthLabel === 'Stale'
        ? 'bg-intel-warn'
        : 'bg-intel-ink3';
  const analysisUpdatedLabel = analysisUpdatedAt ? new Date(analysisUpdatedAt).toLocaleTimeString() : null;
  const emptyStateMessage = ticker.startsWith('O:')
    ? 'Select a contract to load chart data.'
    : 'No chart data available for this symbol.';
  const displayEmptyMessage = sessionMeta?.note ?? emptyStateMessage;
  const timeframeUnit = timeframe.split('/')[1] ?? 'day';
  const isIntraday = timeframeUnit === 'minute' || timeframeUnit === 'hour';
  const hasRenderableData = data.length > 0 && (!isIntraday || data.length >= 2);

  const chartInstanceKey = chartKey ?? 'chart';
  const lastBar = data.at(-1) ?? null;
  const changeUp = displayChange != null && displayChange >= 0;

  // Study toggles — persisted so the workspace comes back as it was left.
  const [studies, setStudies] = useState<IndicatorToggles>(() => readStoredToggles());
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(INDICATOR_STORAGE_KEY, JSON.stringify(studies));
    } catch {
      // persistence is best-effort
    }
  }, [studies]);
  const isIntradayTimeframe = timeframe.endsWith('/minute') || timeframe.endsWith('/hour');
  // VWAP resets per session; on daily bars it isn't meaningful, so drop it
  // from the render (the toggle stays saved for when the user returns intraday).
  const effectiveStudies: IndicatorToggles = isIntradayTimeframe ? studies : { ...studies, vwap: false };

  return (
    <section className="flex min-h-[32rem] min-w-0 flex-col overflow-hidden rounded-panel border border-intel-line bg-intel-panel lg:min-h-[38rem]">
      {/* ── Instrument header: readout left, controls right ─────────────── */}
      <header className="flex flex-col gap-2 border-b border-intel-line px-3 py-2.5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-2.5">
            <span className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-intel-ink3">Chart</span>
            <span className="font-mono text-[15px] font-semibold tracking-wide text-intel-ink">{ticker}</span>
            <span className="font-mono text-[26px] font-semibold leading-none tabular-nums text-intel-ink">
              {displayPrice != null ? displayPrice.toFixed(2) : '--'}
            </span>
            {displayChange != null && displayChangePercent != null && (
              <span className={`flex items-center gap-1 font-mono text-[13px] font-semibold tabular-nums ${changeUp ? 'text-intel-pos' : 'text-intel-neg'}`}>
                {changeUp ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                {changeUp ? '+' : ''}{displayChange.toFixed(2)} ({displayChangePercent.toFixed(2)}%)
              </span>
            )}
            {isFrozen ? (
              <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-[1px] font-mono text-[10px] font-semibold uppercase tracking-label text-intel-warn">
                <Lock className="h-2.5 w-2.5" /> Snapshot
              </span>
            ) : health ? (
              <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-[1px] font-mono text-[10px] font-semibold uppercase tracking-label ${healthTone}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${healthDot}`} aria-hidden="true" />
                {healthLabel}
              </span>
            ) : null}
          </div>
          {/* OHLC micro-readout — the institutional bar summary */}
          {lastBar && (
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] tabular-nums text-intel-ink3">
              <span>O <span className="text-intel-ink2">{lastBar.open?.toFixed(2) ?? '—'}</span></span>
              <span>H <span className="text-intel-pos">{lastBar.high?.toFixed(2) ?? '—'}</span></span>
              <span>L <span className="text-intel-neg">{lastBar.low?.toFixed(2) ?? '—'}</span></span>
              <span>C <span className="text-intel-ink">{lastBar.close?.toFixed(2) ?? '—'}</span></span>
              {lastBar.volume != null && <span>V <span className="text-intel-ink2">{Math.round(lastBar.volume).toLocaleString()}</span></span>}
              <span className="text-intel-ink3">· Massive</span>
            </div>
          )}
          {healthDetail && <p className="mt-0.5 font-mono text-[10px] text-intel-ink3">{healthDetail}</p>}
          {usingLastSession && (
            <p className="mt-0.5 font-mono text-[10px] text-intel-warn/80">
              Last session {resultGranularity === 'daily' ? 'daily' : 'intraday'} candles
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {sessionMode && onSessionModeChange && (
            <div className="flex overflow-hidden rounded-panel border border-intel-line font-mono text-[10px] font-semibold uppercase tracking-label">
              {(['regular', 'extended'] as const).map(mode => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onSessionModeChange(mode)}
                  className={`px-2 py-0.5 transition-colors ${sessionMode === mode ? 'bg-intel-raised text-intel-ink' : 'text-intel-ink3 hover:bg-intel-panel2'}`}
                >
                  {mode === 'regular' ? 'RTH' : 'EXT'}
                </button>
              ))}
            </div>
          )}
          {onRunAnalysis && (
            <button
              type="button"
              onClick={onRunAnalysis}
              disabled={analysisLoading || analysisDisabled}
              className="rounded-md border border-intel-aiLine px-2 py-0.5 font-mono text-[10px] uppercase tracking-label text-intel-ai transition-colors hover:bg-intel-aiSoft disabled:opacity-60"
            >
              {analysisLoading ? 'Analyzing…' : 'Analyze · AI'}
            </button>
          )}
          <div className="flex overflow-hidden rounded-panel border border-intel-line font-mono text-[10px] font-semibold">
            {TIMEFRAMES.map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => onTimeframeChange(option.value)}
                className={`border-l border-intel-line px-2 py-0.5 first:border-l-0 transition-colors ${
                  timeframe === option.value ? 'bg-intel-accent text-intel-bg' : 'text-intel-ink3 hover:bg-intel-panel2'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          {/* Studies — overlay + oscillator toggles */}
          <div className="flex overflow-hidden rounded-panel border border-intel-line font-mono text-[10px] font-semibold">
            {INDICATOR_CHIPS.map(chip => {
              const active = effectiveStudies[chip.key];
              const unavailable = chip.intradayOnly && !isIntradayTimeframe;
              return (
                <button
                  key={chip.key}
                  type="button"
                  title={unavailable ? `${chip.title} — intraday timeframes only` : chip.title}
                  disabled={unavailable}
                  onClick={() => setStudies(prev => ({ ...prev, [chip.key]: !prev[chip.key] }))}
                  className={`border-l border-intel-line px-2 py-0.5 first:border-l-0 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    active ? 'bg-intel-info/20 text-intel-info' : 'text-intel-ink3 hover:bg-intel-panel2'
                  }`}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <div className="relative min-h-[300px] flex-1 p-2">
        {!hasRenderableData ? (
          <div className="flex h-full items-center justify-center px-4 text-center font-mono text-[11px] text-intel-ink3">
            {isLoading ? 'Loading bars…' : displayEmptyMessage}
          </div>
        ) : (
          <TradingViewChart
            key={chartInstanceKey}
            bars={data}
            timeframe={timeframe}
            markers={markers}
            indicators={effectiveStudies}
          />
        )}
        {isLoading && data.length > 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-start justify-end p-3">
            <span className="rounded-md border border-intel-line bg-intel-panel px-1.5 py-[1px] font-mono text-[10px] text-intel-cyan">
              Updating…
            </span>
          </div>
        )}
        {(isFrozen || usingLastSession) && hasRenderableData && (
          <div className="pointer-events-none absolute left-4 top-4 rounded-md border border-intel-line bg-intel-panel/85 px-2 py-1 font-mono text-[10px] uppercase tracking-label text-intel-ink2">
            ◐ Snapshot {healthAge ? `· ${healthAge}` : ''}
          </div>
        )}
      </div>
      {(analysis || analysisError || analysisLoading) && (
        <div className="border-t border-intel-line bg-intel-aiSoft/40 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-[9px] uppercase tracking-label text-intel-ai">Candle Analysis · AI</p>
            {analysisUpdatedLabel && (
              <p className="font-mono text-[10px] text-intel-ink3">{analysisUpdatedLabel}</p>
            )}
          </div>
          {analysisLoading && <p className="mt-1.5 font-mono text-[11px] text-intel-ink3">Building the opening-range read…</p>}
          {!analysisLoading && analysisError && <p className="mt-1.5 font-mono text-[11px] text-intel-warn">{analysisError}</p>}
          {!analysisLoading && analysis && (
            <div className="mt-1.5 space-y-1.5">
              <p className="text-[13px] font-semibold text-intel-ink">{analysis.headline}</p>
              <ul className="space-y-1 text-[11px] text-intel-ink2">
                {analysis.bullets.map(item => (
                  <li key={item} className="flex items-start gap-2">
                    <span className="text-intel-ai">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {sessionMeta?.note && <p className="border-t border-intel-line px-3 py-1.5 font-mono text-[10px] text-intel-ink3">{sessionMeta.note}</p>}
    </section>
  );
});
