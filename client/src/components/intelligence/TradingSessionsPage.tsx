import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Database, RefreshCcw } from 'lucide-react';
import { listTradingSessions, type TradingSession } from '../../api/intelligence';

type Props = {
  initialSessions?: TradingSession[];
  loadOnMount?: boolean;
};

function formatDateTime(value?: string | null): string {
  if (!value) return 'Not captured';
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return 'Not captured';
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatMoney(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Unavailable from captured evidence';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

function formatPercent(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Not captured';
  return `${(value * 100).toFixed(1)}%`;
}

function formatHealth(value: boolean | null | undefined, unavailable = 'Not captured'): string {
  if (value === true) return 'Healthy';
  if (value === false) return 'Needs review';
  return unavailable;
}

function marketStatusLabel(value: string): string {
  if (value === 'UNAVAILABLE') return 'Market status unavailable from captured evidence';
  return value;
}

function statusTone(status: TradingSession['status']): string {
  if (status === 'FINALIZED') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200';
  if (status === 'FINALIZATION_FAILED') return 'border-red-500/40 bg-red-500/10 text-red-200';
  return 'border-amber-500/40 bg-amber-500/10 text-amber-100';
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950/70 px-3 py-2">
      <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-gray-100">{value}</p>
    </div>
  );
}

export function TradingSessionsPage({ initialSessions = [], loadOnMount = true }: Props) {
  const [sessions, setSessions] = useState<TradingSession[]>(initialSessions);
  const [loading, setLoading] = useState(loadOnMount && initialSessions.length === 0);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      setSessions(await listTradingSessions(25));
    } catch (err: any) {
      setError(err?.response?.data?.message ?? err?.response?.data?.error ?? err?.message ?? 'Trading sessions unavailable.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!loadOnMount || initialSessions.length > 0) return;
    void refresh();
  }, []);

  const latest = sessions[0] ?? null;
  const finalizedCount = useMemo(() => sessions.filter(session => session.status === 'FINALIZED').length, [sessions]);

  return (
    <section className="pb-24 space-y-4" data-testid="trading-sessions-page">
      <div className="rounded-xl border border-gray-800 bg-gray-950 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-emerald-300">Trading Intelligence</p>
            <h1 className="mt-2 text-2xl font-semibold text-white">Trading Sessions</h1>
            <p className="mt-2 max-w-3xl text-sm text-gray-400">
              Immutable daily evidence captured from Version 1 automation records.
            </p>
          </div>
          <button
            type="button"
            onClick={refresh}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-200 hover:border-emerald-500/60 hover:text-white"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {error}
        </div>
      )}

      {loading && sessions.length === 0 && (
        <div className="rounded-lg border border-gray-800 bg-gray-950 px-4 py-6 text-sm text-gray-300">
          Loading captured trading sessions.
        </div>
      )}

      {!loading && sessions.length === 0 && (
        <div className="rounded-lg border border-gray-800 bg-gray-950 px-4 py-8 text-sm text-gray-300">
          No finalized trading sessions yet.
        </div>
      )}

      {latest && latest.status !== 'FINALIZED' && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          This session is still collecting evidence.
        </div>
      )}

      {latest && (
        <article className="rounded-xl border border-gray-800 bg-gray-950 p-4 sm:p-5 space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold text-white">{latest.tradingDate}</h2>
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone(latest.status)}`}>
                  {latest.status.replaceAll('_', ' ')}
                </span>
                <span className="rounded-full border border-gray-700 px-2.5 py-1 text-xs font-semibold text-gray-300">
                  {latest.environment}
                </span>
              </div>
              <p className="mt-2 text-sm text-gray-400">{marketStatusLabel(latest.marketStatus)}</p>
            </div>
            <div className="grid grid-cols-1 gap-2 text-sm text-gray-300 sm:grid-cols-2">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-gray-500" />
                Started {formatDateTime(latest.startedAt)}
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-gray-500" />
                Finalized {formatDateTime(latest.finalizedAt)}
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Watchlist size" value={latest.watchlist.size} />
            <Stat label="Symbols evaluated" value={latest.evaluationSummary.symbolsEvaluated} />
            <Stat label="Signals" value={latest.evaluationSummary.signalsGenerated} />
            <Stat label="Data rejects" value={latest.evaluationSummary.dataRejectCount} />
            <Stat label="Risk rejects" value={latest.evaluationSummary.riskRejectCount} />
            <Stat label="Trades opened" value={latest.tradeSummary.tradesOpened} />
            <Stat label="Trades closed" value={latest.tradeSummary.tradesClosed} />
            <Stat label="Wins / Losses" value={`${latest.tradeSummary.winningTrades} / ${latest.tradeSummary.losingTrades}`} />
            <Stat label="Realized P/L" value={formatMoney(latest.tradeSummary.realizedPnl)} />
            <Stat label="Orders" value={latest.orderSummary.ordersSubmitted} />
            <Stat label="Fills" value={latest.orderSummary.fills} />
            <Stat label="Cancels" value={latest.orderSummary.cancellations} />
            <Stat label="Rate limits" value={latest.providerSummary.rateLimitCount} />
            <Stat label="Cache hit rate" value={formatPercent(latest.providerSummary.cacheHitRate)} />
            <Stat label="Reconciliation" value={formatHealth(latest.automationHealth.reconciliationClean)} />
            <Stat label="Broker evidence" value={formatHealth(latest.automationHealth.brokerConnected)} />
          </div>

          {!latest.portfolioSnapshot && (
            <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-4 py-3 text-sm text-gray-300">
              Portfolio snapshot was not captured for this session.
            </div>
          )}

          {(latest.warnings.length > 0 || latest.errors.length > 0) && (
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-100">
                  <AlertTriangle className="h-4 w-4" />
                  Warnings
                </div>
                {latest.warnings.length === 0 ? (
                  <p className="mt-2 text-sm text-gray-400">No warnings captured.</p>
                ) : (
                  <ul className="mt-2 space-y-2 text-sm text-amber-50/90">
                    {latest.warnings.slice(0, 6).map(item => (
                      <li key={item.code}>
                        <span className="font-semibold">{item.code}</span>: {item.message}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-red-100">
                  <Database className="h-4 w-4" />
                  Errors
                </div>
                {latest.errors.length === 0 ? (
                  <p className="mt-2 text-sm text-gray-400">No critical automation events captured.</p>
                ) : (
                  <ul className="mt-2 space-y-2 text-sm text-red-50/90">
                    {latest.errors.slice(0, 6).map(item => (
                      <li key={`${item.code}-${item.component ?? 'component'}`}>
                        <span className="font-semibold">{item.code}</span>: {item.message}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </article>
      )}
    </section>
  );
}
