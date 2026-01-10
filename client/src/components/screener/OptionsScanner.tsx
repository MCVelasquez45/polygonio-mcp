import type { ChecklistResult, WatchlistReport } from '../../api/analysis';
import { formatExpirationDate } from '../../utils/expirations';

type Props = {
  reports?: WatchlistReport[];
  isLoading?: boolean;
  onTickerSelect?: (ticker: string) => void;
  highlights?: Record<string, ChecklistResult>;
  highlightLoading?: boolean;
  onRunScan?: () => void;
  runDisabled?: boolean;
  aiDisabled?: boolean;
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

export function OptionsScanner({
  reports,
  isLoading,
  onTickerSelect,
  highlights,
  highlightLoading,
  onRunScan,
  runDisabled,
  aiDisabled
}: Props) {
  const hasReports = Boolean(reports?.length);
  const rows = hasReports ? reports ?? [] : [];
  const showEmptyState = !isLoading && !hasReports;
  const showDisabledState = aiDisabled && !isLoading && !hasReports;

  return (
    <section className="bg-gray-950 border border-gray-900 rounded-2xl p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.4em] text-gray-500">Options Scanner</p>
          <h2 className="text-2xl font-semibold">Live flows + vol regimes</h2>
          <p className="text-sm text-gray-400">
            Signals update as Massive publishes new contract trades. Click a ticker to load it on the desk.
          </p>
        </div>
        {onRunScan && (
          <button
            type="button"
            onClick={onRunScan}
            disabled={runDisabled || isLoading || highlightLoading}
            className="px-3 py-1.5 text-xs rounded-full border border-gray-800 text-gray-300 hover:border-emerald-500/40 hover:text-white disabled:opacity-60"
          >
            Run AI scan
          </button>
        )}
      </div>

      {showDisabledState ? (
        <div className="rounded-2xl border border-gray-900 bg-gray-950 p-6 text-center text-sm text-gray-400">
          AI scanner is disabled in Settings.
        </div>
      ) : isLoading ? (
        <div className="rounded-2xl border border-gray-900 bg-gray-950 p-6 text-center text-sm text-gray-400">
          Fetching AI reports…
        </div>
      ) : showEmptyState ? (
        <div className="rounded-2xl border border-gray-900 bg-gray-950 p-6 text-center text-sm text-gray-400">
          Run a scan to generate watchlist highlights.
        </div>
      ) : (
        <div className="space-y-3">
          {highlightLoading && (
            <div className="rounded-2xl border border-gray-900 bg-gray-950 p-3 text-xs text-gray-500">
              Running checklist scan across watchlist…
            </div>
          )}
          {rows.map(row => {
            const sentimentBadge = formatSentimentLabel(row.sentiment);
            const symbolKey = row.symbol?.toUpperCase();
            const highlight = symbolKey && highlights ? highlights[symbolKey] : undefined;
            const failing =
              highlight?.factors?.filter(factor => !factor.passed).map(factor => factor.label) ?? [];
            return (
              <button
                key={`${row.symbol}-${row.contract ?? row.headline ?? row.summary}`}
                type="button"
                onClick={() => onTickerSelect?.(row.symbol)}
                className={`w-full text-left rounded-2xl border p-4 transition-colors ${
                  highlight
                    ? highlight.qualifies
                      ? 'border-emerald-500/60 bg-emerald-500/10'
                      : 'border-amber-500/50 bg-amber-500/10'
                    : 'border-gray-900 bg-gray-950 hover:border-emerald-500/50'
                }`}
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
                  {highlight && (
                    <div className="flex items-center justify-between w-full text-xs mt-2">
                      <span
                        className={`font-semibold ${
                          highlight.qualifies ? 'text-emerald-200' : 'text-amber-200'
                        }`}
                      >
                        {highlight.qualifies ? 'Checklist ✅ High-ROI ready' : 'Checklist ⚠ Needs review'}
                      </span>
                      {failing.length > 0 && (
                        <span className="text-gray-300">
                          Missing: {failing.slice(0, 3).join(', ')}
                          {failing.length > 3 ? '…' : ''}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
