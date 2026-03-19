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
          <div className="grid gap-3 md:grid-cols-3">
            <MetricCard label="PnL" value={`${backtestResults.pnl.toFixed(2)}%`} />
            <MetricCard label="Win Rate" value={`${backtestResults.winRate.toFixed(2)}%`} />
            <MetricCard label="Trades" value={String(backtestResults.totalTrades)} />
          </div>
          <div className="rounded-2xl border border-gray-900 bg-gray-900/40 p-4">
            <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Recent Trades</p>
            <div className="mt-3 space-y-2">
              {backtestResults.trades.slice(0, 8).map(trade => (
                <div key={`${trade.entryTime}-${trade.exitTime}`} className="flex items-center justify-between gap-4 rounded-xl border border-gray-800 px-3 py-2 text-sm">
                  <div>
                    <p className="font-medium text-white">{trade.side.toUpperCase()} · {trade.reason}</p>
                    <p className="text-xs text-gray-500">
                      {new Date(trade.entryTime).toISOString()} → {new Date(trade.exitTime).toISOString()}
                    </p>
                  </div>
                  <div className={`text-right ${trade.pnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                    <p>{trade.pnl.toFixed(2)}%</p>
                    <p className="text-xs text-gray-500">{trade.barsHeld} bars</p>
                  </div>
                </div>
              ))}
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
