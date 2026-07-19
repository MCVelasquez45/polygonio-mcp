import type { ChecklistResult, WatchlistReport } from '../../api/analysis';
import { formatExpirationDate } from '../../utils/expirations';
import { Badge, EmptyState } from '../intelligence/ui';
import { ABSENT } from '../../lib/intelligenceFormat';

type SentimentTone = 'pos' | 'neg' | 'neutral';

function formatSentimentLabel(sentiment?: string | null): { label: string; tone: SentimentTone } {
  if (!sentiment) return { label: 'Neutral', tone: 'neutral' };
  const normalized = sentiment.toLowerCase();
  if (normalized.includes('bull')) {
    return { label: 'Bullish', tone: 'pos' };
  }
  if (normalized.includes('bear')) {
    return { label: 'Bearish', tone: 'neg' };
  }
  return { label: sentiment, tone: 'neutral' };
}

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
    <section className="rounded-panel border border-intel-line bg-intel-panel p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <p className="font-mono text-xs uppercase tracking-eyebrow text-intel-accent">Options Scanner</p>
          <h2 className="text-2xl font-semibold text-intel-ink">Live flows + vol regimes</h2>
          <p className="text-sm text-intel-ink2">
            Signals update as Massive publishes new contract trades. Click a ticker to load it on the desk.
          </p>
        </div>
        {onRunScan && (
          <button
            type="button"
            onClick={onRunScan}
            disabled={runDisabled || isLoading || highlightLoading}
            className="px-3 py-1.5 text-xs rounded-full border border-intel-line text-intel-ink2 hover:border-intel-accentLine hover:text-intel-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-intel-accent disabled:opacity-60"
          >
            Run AI scan
          </button>
        )}
      </div>

      {showDisabledState ? (
        <EmptyState title="AI scanner is disabled in Settings." />
      ) : isLoading ? (
        <EmptyState title="Fetching AI reports…" />
      ) : showEmptyState ? (
        <EmptyState title="Run a scan to generate watchlist highlights." />
      ) : (
        <div className="space-y-3">
          {highlightLoading && (
            <div className="rounded-panel border border-intel-line bg-intel-panel p-3 text-xs text-intel-ink3">
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
                className={`w-full text-left rounded-panel border p-4 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-intel-accent ${
                  highlight
                    ? highlight.qualifies
                      ? 'border-intel-pos/60 bg-intel-pos/10'
                      : 'border-intel-warn/50 bg-intel-warn/10'
                    : 'border-intel-line bg-intel-panel hover:border-intel-accentLine'
                }`}
              >
                <div className="flex flex-wrap gap-3 items-center justify-between">
                  <div>
                    <p className="font-mono text-sm uppercase tracking-label text-intel-ink3">{row.symbol}</p>
                    <p className="text-lg font-semibold text-intel-ink">{row.contract ?? row.headline ?? row.symbol}</p>
                  </div>
                  <div className="text-right">
                    {row.expiry && (
                      <p className="text-sm text-intel-ink2">Expires {formatExpirationDate(row.expiry)}</p>
                    )}
                    {row.flow && <p className="font-mono tabular-nums text-base font-semibold text-intel-pos">{row.flow}</p>}
                    {row.ivRank != null && (
                      <p className="font-mono tabular-nums text-xs text-intel-ink3">IV Rank {row.ivRank.toFixed(0)}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <Badge tone={sentimentBadge.tone}>{sentimentBadge.label}</Badge>
                  </div>
                  <div className="text-sm text-intel-ink2 flex-1 min-w-full border-t border-intel-line pt-3">
                    {row.summary ?? row.headline ?? ABSENT}
                  </div>
                  {highlight && (
                    <div className="flex items-center justify-between w-full text-xs mt-2">
                      <span
                        className={`font-semibold ${
                          highlight.qualifies ? 'text-intel-pos' : 'text-intel-warn'
                        }`}
                      >
                        {highlight.qualifies ? 'Checklist ✅ High-ROI ready' : 'Checklist ⚠ Needs review'}
                      </span>
                      {failing.length > 0 && (
                        <span className="text-intel-ink2">
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
