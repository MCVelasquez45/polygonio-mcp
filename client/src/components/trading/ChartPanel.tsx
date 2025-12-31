import { AggregateBar, IndicatorBundle } from '../../types/market';
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
  } | null;
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

export function ChartPanel({
  ticker,
  timeframe,
  data,
  indicators,
  isLoading,
  onTimeframeChange,
  fallbackPrice,
  fallbackChange,
  sessionMeta,
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

  return (
    <section className="bg-gray-950/70 border border-gray-900/80 backdrop-blur-sm rounded-2xl p-4 flex flex-col gap-3 min-h-[32rem] lg:min-h-[36rem] min-w-0">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.4em] text-gray-500">{ticker}</p>
          <div className="flex items-center gap-3 text-3xl font-semibold">
            <span>{displayPrice != null ? `$${displayPrice.toFixed(2)}` : '--'}</span>
            {displayChange != null && displayChangePercent != null && (
              <span
                className={`flex items-center gap-2 text-lg ${
                  displayChange >= 0 ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {displayChange >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
                {displayChange >= 0 ? '+' : ''}
                {displayChange.toFixed(2)} ({displayChangePercent.toFixed(2)}%)
              </span>
            )}
            {isMarketClosed && (
              <span className="inline-flex items-center gap-1 text-xs text-amber-200 border border-amber-500/30 bg-amber-500/10 rounded-full px-3 py-1">
                <Lock className="h-3 w-3" /> Frozen
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500">Option aggregates pulled directly from Massive</p>
          {usingLastSession && (
            <p className="text-[11px] text-amber-200/80 flex items-center gap-1">
              Last session {resultGranularity === 'daily' ? 'daily' : 'intraday'} candles
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {TIMEFRAMES.map(option => (
            <button
              key={option.value}
              type="button"
              onClick={() => onTimeframeChange(option.value)}
              className={`px-3 py-1.5 text-xs rounded-full border ${
                timeframe === option.value ? 'bg-emerald-500/20 border-emerald-400 text-white' : 'border-gray-800 text-gray-400'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 min-h-[300px]">
        {isLoading ? (
          <div className="h-full flex items-center justify-center text-gray-500 text-sm">Loading bars…</div>
        ) : data.length === 0 ? (
          <div className="h-full flex items-center justify-center text-gray-500 text-sm">Select a contract to load chart data.</div>
        ) : (
          <TradingViewChart bars={data} timeframe={timeframe} />
        )}
      </div>
      {sessionMeta?.note && <p className="text-[11px] text-gray-500">{sessionMeta.note}</p>}
    </section>
  );
}
