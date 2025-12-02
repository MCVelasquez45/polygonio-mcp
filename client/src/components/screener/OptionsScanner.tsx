import type { WatchlistReport } from '../../api/analysis';
import { formatExpirationDate } from '../../utils/expirations';

const FALLBACK_ROWS: WatchlistReport[] = [
  {
    symbol: 'NVDA',
    contract: 'O:NVDA250307C00500000',
    expiry: '2025-03-07',
    ivRank: 72,
    flow: '+$18.5M',
    summary: 'Call sweeps stacked at 500 strike; momentum desk watching for breakout.',
    sentiment: 'bullish'
  },
  {
    symbol: 'TSLA',
    contract: 'O:TSLA250314P00200000',
    expiry: '2025-03-14',
    ivRank: 54,
    flow: '-$7.3M',
    summary: 'Put protection rolling higher as implied vol cools.',
    sentiment: 'bearish'
  },
  {
    symbol: 'SPY',
    contract: 'O:SPY250221C00525000',
    expiry: '2025-02-21',
    ivRank: 33,
    flow: '+$24.9M',
    summary: 'Gamma flip expected above 525 — dealers likely to chase delta.',
    sentiment: 'neutral'
  }
];

type Props = {
  reports?: WatchlistReport[];
  isLoading?: boolean;
  onTickerSelect?: (ticker: string) => void;
};

function formatSentimentLabel(sentiment?: string | null) {
  if (!sentiment) return { label: 'Neutral', color: 'text-gray-300', ring: 'border-gray-800' };
  const normalized = sentiment.toLowerCase();
  if (normalized.includes('bull')) {
    return { label: 'Bullish', color: 'text-emerald-300', ring: 'border-emerald-500/40' };
  }
  if (normalized.includes('bear')) {
    return { label: 'Bearish', color: 'text-red-300', ring: 'border-red-500/40' };
  }
  return { label: sentiment, color: 'text-gray-300', ring: 'border-gray-800' };
}

export function OptionsScanner({ reports, isLoading, onTickerSelect }: Props) {
  const rows = reports && reports.length ? reports : FALLBACK_ROWS;

  return (
    <section className="bg-gray-950 border border-gray-900 rounded-2xl p-6 space-y-4">
      <div className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.4em] text-gray-500">Options Scanner</p>
        <h2 className="text-2xl font-semibold">Live flows + vol regimes</h2>
        <p className="text-sm text-gray-400">Signals update as Massive publishes new contract trades. Click a ticker to load it on the desk.</p>
      </div>

      {isLoading ? (
        <div className="rounded-2xl border border-gray-900 bg-gray-950 p-6 text-center text-sm text-gray-400">
          Fetching AI reports…
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map(row => {
            const sentimentBadge = formatSentimentLabel(row.sentiment);
            return (
              <button
                key={`${row.symbol}-${row.contract ?? row.headline ?? row.summary}`}
                type="button"
                onClick={() => onTickerSelect?.(row.symbol)}
                className="w-full text-left rounded-2xl border border-gray-900 bg-gray-950 p-4 hover:border-emerald-500/50 transition-colors"
              >
                <div className="flex flex-wrap gap-3 items-center justify-between">
                  <div>
                    <p className="text-sm uppercase tracking-[0.3em] text-gray-500">{row.symbol}</p>
                    <p className="text-lg font-semibold text-white">{row.contract ?? row.headline ?? row.symbol}</p>
                  </div>
                  <div className="text-right">
                    {row.expiry && (
                      <p className="text-sm text-gray-400">Expires {formatExpirationDate(row.expiry)}</p>
                    )}
                    {row.flow && <p className="text-base font-semibold text-emerald-400">{row.flow}</p>}
                    {row.ivRank != null && (
                      <p className="text-xs text-gray-500">IV Rank {row.ivRank.toFixed(0)}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span
                      className={`inline-flex items-center gap-2 rounded-full border px-2 py-1 ${sentimentBadge.ring} ${sentimentBadge.color}`}
                    >
                      {sentimentBadge.label}
                    </span>
                  </div>
                  <div className="text-sm text-gray-300 flex-1 min-w-full border-t border-gray-900 pt-3">
                    {row.summary ?? row.headline ?? 'No summary available.'}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
