import type { BacktestResult, BacktestRunRecord } from './types';

type Props = {
  canRun: boolean;
  isBacktesting: boolean;
  backtestRun: BacktestRunRecord | null;
  backtestResults: BacktestResult | null;
  onRun: () => void;
};

export function StrategyBacktestPanel({ canRun, isBacktesting, backtestRun, backtestResults, onRun }: Props) {
  return (
    <section className="rounded-2xl border border-gray-900 bg-gray-950/70 p-4 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Backtest</p>
          <h2 className="text-lg font-semibold text-white">Local Mock Orchestrator</h2>
        </div>
        <button
          type="button"
          onClick={onRun}
          disabled={!canRun || isBacktesting}
          className="rounded-full border border-amber-500/40 px-4 py-2 text-sm text-amber-100 hover:bg-amber-500/10 disabled:opacity-60"
        >
          {isBacktesting ? 'Running...' : 'Run Backtest'}
        </button>
      </div>

      {!backtestResults ? (
        <div className="rounded-2xl border border-dashed border-gray-800 px-4 py-8 text-sm text-gray-500 text-center">
          Compile a strategy version before running the mock backtest.
        </div>
      ) : (
        <>
          {backtestRun && (
            <div className="rounded-2xl border border-gray-900 bg-gray-900/40 p-4 text-xs text-gray-400">
              Immutable run: <span className="text-white">{backtestRun._id}</span> · Seed:{' '}
              <span className="text-white">{backtestRun.seedKey}</span>
            </div>
          )}
          {backtestResults.diagnostics?.dataWarning && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
              <p className="font-semibold mb-1">Data Source Warning</p>
              <p className="text-xs text-amber-300/80">{backtestResults.diagnostics.dataWarning}</p>
            </div>
          )}
          {backtestResults.diagnostics?.resolvedSymbol && (
            <div className="text-xs text-gray-500">
              Symbol: <span className="text-gray-300">{backtestResults.diagnostics.resolvedSymbol}</span>
              {backtestResults.diagnostics?.provider && (
                <> · Provider: <span className="text-gray-300">{backtestResults.diagnostics.provider}</span></>
              )}
              {backtestResults.diagnostics?.barsLoaded != null && (
                <> · Bars: <span className="text-gray-300">{backtestResults.diagnostics.barsLoaded}</span></>
              )}
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-3">
            <MetricCard label="PnL" value={`${backtestResults.pnl.toFixed(2)}%`} />
            <MetricCard label="Win Rate" value={`${backtestResults.winRate.toFixed(2)}%`} />
            <MetricCard label="Trades" value={String(backtestResults.totalTrades)} />
            {backtestResults.sharpeRatio != null && (
              <MetricCard label="Sharpe" value={backtestResults.sharpeRatio.toFixed(2)} />
            )}
            {backtestResults.maxDrawdownPct != null && (
              <MetricCard label="Max Drawdown" value={`${backtestResults.maxDrawdownPct.toFixed(2)}%`} />
            )}
          </div>
          <div className="rounded-2xl border border-gray-900 bg-gray-900/40 p-4">
            <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Recent Trades</p>
            <div className="mt-3 space-y-2">
              {backtestResults.trades.slice(0, 8).map((trade: any, idx: number) => {
                // Handle both trade formats:
                // Pipeline format: { entryTime, exitTime, side, pnl, barsHeld, reason }
                // Strategy engine format: { timestamp, side, contracts, fillPrice, pnl, reason }
                const time = trade.entryTime || trade.timestamp || '';
                const timeStr = time ? new Date(time).toLocaleDateString() : '—';
                const side = trade.side ?? 'sell';
                const reason = trade.reason ?? '';
                const pnl = typeof trade.pnl === 'number' ? trade.pnl : 0;
                const isPipelineFormat = !!trade.entryTime;

                return (
                <div key={`${time}-${idx}`} className="flex items-center justify-between gap-4 rounded-xl border border-gray-800 px-3 py-2 text-sm">
                  <div>
                    <p className="font-medium text-white">
                      {side.toUpperCase()} · {reason}
                      {trade.spreadType && <span className="ml-2 text-xs text-purple-300">{trade.spreadType}</span>}
                      {trade.regime && <span className="ml-2 text-xs" style={{ color: trade.regime === 'risk_on' ? '#6ee7b7' : trade.regime === 'risk_off' ? '#fca5a5' : '#9ca3af' }}>{trade.regime}</span>}
                    </p>
                    <p className="text-xs text-gray-500">
                      {timeStr}
                      {isPipelineFormat && trade.exitTime && <> → {new Date(trade.exitTime).toLocaleDateString()}</>}
                      {trade.contracts && <span className="ml-2 text-gray-400">{trade.contracts} contracts</span>}
                      {trade.contractSymbol && <span className="ml-2 text-gray-400">{trade.contractSymbol}</span>}
                      {trade.dte != null && <span className="ml-2 text-gray-400">{trade.dte}DTE</span>}
                    </p>
                  </div>
                  <div className={`text-right ${pnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                    <p>{isPipelineFormat ? `${pnl.toFixed(2)}%` : `$${pnl.toFixed(2)}`}</p>
                    <p className="text-xs text-gray-500">
                      {isPipelineFormat && trade.barsHeld != null && <>{trade.barsHeld} bars</>}
                      {!isPipelineFormat && trade.fillPrice != null && <>@ ${trade.fillPrice.toFixed(2)}</>}
                      {trade.creditReceived != null && <span className="ml-2">Credit: ${trade.creditReceived.toFixed(2)}</span>}
                    </p>
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-gray-900 bg-gray-900/40 p-4">
      <p className="text-xs uppercase tracking-[0.3em] text-gray-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}
