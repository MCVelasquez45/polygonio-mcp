import { useEffect, useState } from 'react';
import { futuresApi } from '../../api';
import type { BacktestSummary } from '../../api/futures';

type Props = {
  strategyId: string;
  strategyName?: string;
  onSelectBacktest: (backtestId: string) => void;
  onRunNew: () => void;
  onBack: () => void;
  onEditStrategy?: () => void;
  onViewPaperSessions?: () => void;
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateRange(start: string, end: string): string {
  return `${formatDate(start)} - ${formatDate(end)}`;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(dateStr);
}

export function BacktestHistoryPanel({ strategyId, strategyName, onSelectBacktest, onRunNew, onBack, onEditStrategy, onViewPaperSessions }: Props) {
  const [backtests, setBacktests] = useState<BacktestSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    futuresApi
      .listStrategyBacktests(strategyId)
      .then(data => {
        if (!cancelled) setBacktests(data);
      })
      .catch(err => {
        if (!cancelled) setError(err?.message ?? 'Failed to load backtest history');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [strategyId]);

  return (
    <div className="bth-panel">
      <div className="bth-header">
        <div className="bth-header-left">
          <button className="bth-back-btn" onClick={onBack} title="Back to strategies">&larr;</button>
          <div>
            <h2>{strategyName ?? 'Strategy'}</h2>
            <span className="bth-subtitle">Backtest History &middot; {backtests.length} run{backtests.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <div className="bth-header-actions">
          {onViewPaperSessions && <button className="bth-edit-btn" onClick={onViewPaperSessions}>Paper Sessions</button>}
          {onEditStrategy && <button className="bth-edit-btn" onClick={onEditStrategy}>Edit Strategy</button>}
          <button className="bth-run-btn" onClick={onRunNew}>+ New Backtest</button>
        </div>
      </div>

      {loading && (
        <div className="bth-loading">
          <div className="bth-spinner" />
          <span>Loading backtest history...</span>
        </div>
      )}

      {error && (
        <div className="bth-error">
          <span>&#9888;</span> {error}
        </div>
      )}

      {!loading && !error && backtests.length === 0 && (
        <div className="bth-empty">
          <div className="bth-empty-icon">&#128202;</div>
          <h3>No backtests yet</h3>
          <p>Run your first backtest to see results here.</p>
          <button className="bth-run-btn" onClick={onRunNew}>Run Backtest</button>
        </div>
      )}

      {!loading && backtests.length > 0 && (
        <div className="bth-list">
          {backtests.map((bt, idx) => {
            const ret = bt.metrics.totalReturnPct * 100;
            const dd = Math.abs(bt.metrics.maxDrawdownPct * 100);
            const wr = bt.metrics.winRatePct * 100;
            const isPositive = ret >= 0;
            return (
              <button
                key={bt._id}
                className="bth-card"
                onClick={() => onSelectBacktest(bt._id)}
              >
                <div className="bth-card-top">
                  <div className="bth-card-rank">
                    {idx === 0 && <span className="bth-latest-badge">Latest</span>}
                    <span className="bth-card-time">{timeAgo(bt.createdAt)}</span>
                  </div>
                  <span className={`bth-return ${isPositive ? 'positive' : 'negative'}`}>
                    {isPositive ? '+' : ''}{ret.toFixed(2)}%
                  </span>
                </div>

                <div className="bth-card-metrics">
                  <div className="bth-metric">
                    <span className="bth-metric-label">Sharpe</span>
                    <span className="bth-metric-value">{bt.metrics.sharpeRatio.toFixed(2)}</span>
                  </div>
                  <div className="bth-metric">
                    <span className="bth-metric-label">Max DD</span>
                    <span className="bth-metric-value negative">-{dd.toFixed(1)}%</span>
                  </div>
                  <div className="bth-metric">
                    <span className="bth-metric-label">Win Rate</span>
                    <span className="bth-metric-value">{wr.toFixed(0)}%</span>
                  </div>
                  <div className="bth-metric">
                    <span className="bth-metric-label">Trades</span>
                    <span className="bth-metric-value">{bt.metrics.tradeCount}</span>
                  </div>
                </div>

                <div className="bth-card-footer">
                  <span className="bth-card-symbol">{bt.symbol}</span>
                  <span className="bth-card-range">{formatDateRange(bt.config.startDate, bt.config.endDate)}</span>
                  <span className={`bth-provider bth-provider-${bt.provider}`}>
                    {bt.provider === 'polygon' ? 'Polygon' : bt.provider === 'databento' ? 'Databento' : bt.provider === 'synthetic' ? 'Synthetic' : bt.provider}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <style>{historyStyles}</style>
    </div>
  );
}

const historyStyles = `
  .bth-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #0a0a0f;
    color: #e5e5e5;
    padding: 1.5rem;
    overflow-y: auto;
  }

  .bth-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
  }

  .bth-header-left {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .bth-back-btn {
    background: transparent;
    border: 1px solid #333;
    color: #9ca3af;
    width: 2rem;
    height: 2rem;
    border-radius: 0.5rem;
    cursor: pointer;
    font-size: 1rem;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }
  .bth-back-btn:hover { border-color: #666; color: #e5e5e5; }

  .bth-header h2 {
    margin: 0;
    font-size: 1.25rem;
    background: linear-gradient(90deg, #e5e5e5, #9ca3af);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  .bth-subtitle {
    font-size: 0.8rem;
    color: #6b7280;
  }

  .bth-header-actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .bth-edit-btn {
    background: transparent;
    border: 1px solid #333;
    color: #9ca3af;
    padding: 0.5rem 1rem;
    border-radius: 0.5rem;
    font-weight: 500;
    font-size: 0.85rem;
    cursor: pointer;
    transition: all 0.2s;
  }
  .bth-edit-btn:hover { border-color: #666; color: #e5e5e5; }

  .bth-run-btn {
    background: #10b981;
    border: none;
    color: white;
    padding: 0.5rem 1rem;
    border-radius: 0.5rem;
    font-weight: 600;
    font-size: 0.85rem;
    cursor: pointer;
    transition: all 0.2s;
  }
  .bth-run-btn:hover { background: #059669; transform: translateY(-1px); }

  .bth-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 3rem 1rem;
    color: #6b7280;
    font-size: 0.9rem;
  }

  .bth-spinner {
    width: 1.25rem;
    height: 1.25rem;
    border: 2px solid rgba(255,255,255,0.1);
    border-top-color: #10b981;
    border-radius: 50%;
    animation: bth-spin 0.8s linear infinite;
  }
  @keyframes bth-spin { to { transform: rotate(360deg); } }

  .bth-error {
    padding: 0.75rem 1rem;
    background: rgba(239, 68, 68, 0.08);
    border: 1px solid rgba(239, 68, 68, 0.2);
    border-radius: 0.5rem;
    color: #f87171;
    font-size: 0.85rem;
  }

  .bth-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 4rem 1rem;
    text-align: center;
    color: #6b7280;
  }
  .bth-empty-icon { font-size: 3rem; margin-bottom: 1rem; opacity: 0.5; }
  .bth-empty h3 { margin: 0 0 0.5rem; color: #9ca3af; font-size: 1.1rem; }
  .bth-empty p { margin: 0 0 1.5rem; font-size: 0.85rem; }

  .bth-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .bth-card {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem 1.25rem;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 0.75rem;
    cursor: pointer;
    transition: all 0.2s;
    text-align: left;
    width: 100%;
    color: inherit;
    font-family: inherit;
    font-size: inherit;
  }
  .bth-card:hover {
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(16, 185, 129, 0.3);
    transform: translateY(-1px);
  }

  .bth-card-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .bth-card-rank {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .bth-latest-badge {
    background: rgba(16, 185, 129, 0.15);
    color: #10b981;
    border: 1px solid rgba(16, 185, 129, 0.3);
    padding: 0.1rem 0.5rem;
    border-radius: 1rem;
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .bth-card-time {
    font-size: 0.8rem;
    color: #6b7280;
  }

  .bth-return {
    font-size: 1.25rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .bth-return.positive { color: #10b981; }
  .bth-return.negative { color: #ef4444; }

  .bth-card-metrics {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.5rem;
  }

  .bth-metric {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .bth-metric-label {
    font-size: 0.65rem;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .bth-metric-value {
    font-size: 0.9rem;
    font-weight: 600;
    color: #d1d5db;
    font-variant-numeric: tabular-nums;
  }
  .bth-metric-value.negative { color: #ef4444; }

  .bth-card-footer {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 0.75rem;
    color: #6b7280;
    border-top: 1px solid rgba(255, 255, 255, 0.04);
    padding-top: 0.5rem;
  }

  .bth-card-symbol {
    font-weight: 600;
    color: #9ca3af;
  }

  .bth-provider {
    margin-left: auto;
    padding: 0.1rem 0.4rem;
    border-radius: 0.25rem;
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .bth-provider-polygon { background: rgba(16, 185, 129, 0.1); color: #10b981; }
  .bth-provider-databento { background: rgba(59, 130, 246, 0.1); color: #3b82f6; }
  .bth-provider-synthetic { background: rgba(245, 158, 11, 0.1); color: #f59e0b; }
`;

export default BacktestHistoryPanel;
