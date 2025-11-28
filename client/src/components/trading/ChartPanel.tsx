import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AggregateBar, IndicatorBundle } from '../../types/market';
import { TrendingDown, TrendingUp } from 'lucide-react';

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
};

const TIMEFRAMES: TimeframeOption[] = [
  { label: '1D', value: '1/day' },
  { label: '1H', value: '1/hour' },
  { label: '5M', value: '5/minute' },
];

type ChartDatum = {
  time: string;
  close: number;
  volume: number;
  sma?: number | null;
};

export function ChartPanel({
  ticker,
  timeframe,
  data,
  indicators,
  isLoading,
  onTimeframeChange,
  fallbackPrice,
  fallbackChange,
}: Props) {
  const chartData = useMemo<ChartDatum[]>(() => {
    if (!data.length) return [];
    const smaMap = new Map(indicators?.sma?.values?.map(point => [point.timestamp, point.value]));
    return data.map(bar => ({
      time: new Date(bar.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      close: bar.close,
      volume: bar.volume,
      sma: smaMap.get(bar.timestamp) ?? null,
    }));
  }, [data, indicators]);

  const currentPrice = chartData.at(-1)?.close ?? null;
  const openPrice = chartData.at(0)?.close ?? null;
  const change = currentPrice != null && openPrice != null ? currentPrice - openPrice : null;
  const changePercent = change != null && openPrice ? (change / openPrice) * 100 : null;
  const displayPrice = currentPrice ?? fallbackPrice ?? null;
  const displayChange = change ?? fallbackChange?.absolute ?? null;
  const displayChangePercent = changePercent ?? fallbackChange?.percent ?? null;

  return (
    <section className="bg-gray-950 border border-gray-900 rounded-2xl p-4 flex flex-col gap-3 min-h-[32rem] lg:min-h-[36rem] min-w-0">
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
          </div>
          <p className="text-xs text-gray-500">Option aggregates pulled directly from Massive</p>
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
        ) : chartData.length === 0 ? (
          <div className="h-full flex items-center justify-center text-gray-500 text-sm">Select a contract to load chart data.</div>
        ) : (
          <div className="h-full flex flex-col gap-4">
            <div className="w-full flex-1 min-h-[300px]">
              <div className="w-full h-full min-h-[300px] aspect-[16/9]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -18, bottom: 5 }}>
                    <defs>
                      <linearGradient id="priceArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#34d399" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" opacity={0.3} />
                  <XAxis dataKey="time" stroke="#6b7280" tickLine={false} />
                  <YAxis stroke="#6b7280" tickLine={false} tickFormatter={value => `$${Number(value).toFixed(2)}`} />
                  <Tooltip
                    contentStyle={{ background: '#0f172a', border: '1px solid #1f2937', borderRadius: 12 }}
                    cursor={{ stroke: '#1f2937' }}
                  />
                  {openPrice && <ReferenceLine y={openPrice} stroke="#374151" strokeDasharray="4 4" />}
                  <Area type="monotone" dataKey="close" stroke="#34d399" strokeWidth={2} fill="url(#priceArea)" />
                  <Area type="monotone" dataKey="sma" stroke="#60a5fa" strokeWidth={1.5} dot={false} fillOpacity={0} />
                </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="h-24">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} barSize={6}>
                  <CartesianGrid vertical={false} stroke="#1f2937" opacity={0.3} />
                  <XAxis dataKey="time" hide />
                  <YAxis hide />
                  <Tooltip
                    contentStyle={{ background: '#0f172a', border: '1px solid #1f2937', borderRadius: 12 }}
                    cursor={{ fill: '#1f2937' }}
                  />
                  <Bar dataKey="volume" fill="#4b5563" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
