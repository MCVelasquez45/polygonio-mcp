import { useState, useEffect } from 'react';
import { apiClient } from '../../api';

type Strategy = {
  id: string;
  _id?: string;
  name: string;
  version: string;
  status: 'draft' | 'backtesting' | 'paper_trading' | 'live' | 'paused' | 'archived';
  type: string;
  metrics?: {
    sharpe?: number;
    return?: number;
    maxDrawdown?: number;
    winRate?: number;
  };
  paperTradingDays?: number;
  lastUpdated: string;
  created_by?: string;
};

type Props = {
  onSelectStrategy?: (strategy: Strategy) => void;
  onCreateNew?: () => void;
  refreshKey?: number;
};

const STATUS_CONFIG = {
  draft: { label: 'Draft', color: '#64748b', icon: '📝' },        // intel-ink3
  backtesting: { label: 'Backtesting', color: '#fbbf24', icon: '🔬' }, // intel-warn
  paper_trading: { label: 'Paper Trading', color: '#6aa5f5', icon: '📊' }, // intel-info
  live: { label: 'Live', color: '#35d29a', icon: '🔥' },          // intel-pos
  paused: { label: 'Paused', color: '#f87171', icon: '⏸️' },      // intel-neg
  archived: { label: 'Archived', color: '#64748b', icon: '📦' },  // intel-ink3
};

function mapStrategyStatus(raw: string): Strategy['status'] {
  if (raw === 'development') return 'draft';
  if (raw === 'validated') return 'backtesting';
  if (raw === 'failed') return 'paused';
  if (raw === 'paper_trading' || raw === 'backtesting' || raw === 'live' || raw === 'paused' || raw === 'archived') {
    return raw;
  }
  return 'draft';
}

function StrategyCard({ strategy, onClick }: { strategy: Strategy; onClick?: () => void }) {
  const config = STATUS_CONFIG[strategy.status];

  return (
    <div className="strategy-card" onClick={onClick}>
      <div className="strategy-header">
        <span className="strategy-icon">{config.icon}</span>
        <div className="strategy-title">
          <h4>{strategy.name}</h4>
          <span className="strategy-version">{strategy.version}</span>
        </div>
      </div>

      <div className="strategy-status" style={{ backgroundColor: `${config.color}20`, color: config.color }}>
        {config.label}
      </div>

      <div className="strategy-type">{strategy.type}</div>

      {strategy.metrics && (
        <div className="strategy-metrics">
          {strategy.metrics.sharpe && (
            <div className="metric">
              <span className="metric-label">Sharpe</span>
              <span className="metric-value">{strategy.metrics.sharpe.toFixed(2)}</span>
            </div>
          )}
          {strategy.metrics.return && (
            <div className="metric">
              <span className="metric-label">Return</span>
              <span className={`metric-value ${strategy.metrics.return >= 0 ? 'positive' : 'negative'}`}>
                {strategy.metrics.return >= 0 ? '+' : ''}{strategy.metrics.return.toFixed(1)}%
              </span>
            </div>
          )}
        </div>
      )}

      {strategy.status === 'paper_trading' && strategy.paperTradingDays && (
        <div className="paper-trading-progress">
          <span className="progress-label">Day {strategy.paperTradingDays}/15</span>
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${(strategy.paperTradingDays / 15) * 100}%` }}
            />
          </div>
        </div>
      )}

      <div className="strategy-footer">
        <span className="last-updated">
          Updated {new Date(strategy.lastUpdated).toLocaleDateString()}
        </span>
      </div>
    </div>
  );
}

export function StrategyListPanel({ onSelectStrategy, onCreateNew, refreshKey = 0 }: Props) {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'pipeline' | 'list'>('pipeline');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  useEffect(() => {
    const fetchStrategies = async () => {
      try {
        setLoading(true);
        const response = await apiClient.get('/api/lab/strategies');
        const data = Array.isArray(response.data) ? response.data : [];
        const mapped: Strategy[] = data.map((item: any) => ({
          id: String(item._id ?? item.id),
          _id: String(item._id ?? item.id),
          name: item.name ?? 'Unnamed Strategy',
          version: item.version ?? 'v1.0',
          status: mapStrategyStatus(String(item.status ?? 'draft')),
          type: String(item.strategyType ?? 'custom'),
          metrics: item.backtestResults?.metrics
            ? {
                sharpe: item.backtestResults.metrics.sharpeRatio,
                return: (item.backtestResults.metrics.expectedValue ?? 0) * 100,
                maxDrawdown: (item.backtestResults.metrics.drawdown ?? 0) * -100,
                winRate: (item.backtestResults.metrics.winRate ?? 0) * 100
              }
            : undefined,
          paperTradingDays: item.paperTradingDays ?? undefined,
          lastUpdated: item.updatedAt ?? item.createdAt ?? new Date().toISOString(),
          created_by: item.ownerId
        }));
        setStrategies(mapped);
        setLoading(false);
      } catch (error) {
        console.error('Failed to fetch strategies:', error);
        setLoading(false);
      }
    };

    fetchStrategies();
  }, [refreshKey]);

  const pipelineStages = ['draft', 'backtesting', 'paper_trading', 'live'];

  const getStrategiesByStatus = (status: string) => {
    return strategies.filter(s => s.status === status);
  };

  const filteredStrategies = filterStatus === 'all'
    ? strategies
    : strategies.filter(s => s.status === filterStatus);

  if (loading) {
    return (
      <div className="strategy-list-panel">
        <div className="loading-state">
          <div className="loading-spinner" />
          <p>Loading strategies...</p>
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  return (
    <div className="strategy-list-panel">
      <div className="panel-header">
        <div className="header-left">
          <h2>📋 My Strategies</h2>
          <span className="strategy-count">{strategies.length} strategies</span>
        </div>
        <div className="header-right">
          <div className="view-toggle">
            <button
              className={viewMode === 'pipeline' ? 'active' : ''}
              onClick={() => setViewMode('pipeline')}
            >
              Pipeline
            </button>
            <button
              className={viewMode === 'list' ? 'active' : ''}
              onClick={() => setViewMode('list')}
            >
              List
            </button>
          </div>
          <button className="create-btn" onClick={onCreateNew}>
            <span>+</span> New Strategy
          </button>
        </div>
      </div>

      {viewMode === 'pipeline' ? (
        <div className="pipeline-view">
          {pipelineStages.map(stage => {
            const stageStrategies = getStrategiesByStatus(stage);
            const config = STATUS_CONFIG[stage as keyof typeof STATUS_CONFIG];

            return (
              <div key={stage} className="pipeline-column">
                <div className="column-header">
                  <span className="column-icon">{config.icon}</span>
                  <span className="column-title">{config.label}</span>
                  <span className="column-count">{stageStrategies.length}</span>
                </div>
                <div className="column-content">
                  {stageStrategies.map(strategy => (
                    <StrategyCard
                      key={strategy.id}
                      strategy={strategy}
                      onClick={() => onSelectStrategy?.(strategy)}
                    />
                  ))}
                  {stageStrategies.length === 0 && (
                    <div className="empty-column">
                      <span>No strategies</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="list-view">
          <div className="list-filters">
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="all">All Statuses</option>
              {Object.entries(STATUS_CONFIG).map(([key, config]) => (
                <option key={key} value={key}>{config.label}</option>
              ))}
            </select>
          </div>
          <div className="strategy-list">
            {filteredStrategies.map(strategy => (
              <StrategyCard
                key={strategy.id}
                strategy={strategy}
                onClick={() => onSelectStrategy?.(strategy)}
              />
            ))}
          </div>
        </div>
      )}

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .strategy-list-panel {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: #020617;
    color: #e9edf6;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.5rem;
    border-bottom: 1px solid #1e293b;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .header-left h2 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
    color: #e9edf6;
  }

  .strategy-count {
    color: #64748b;
    font-size: 0.875rem;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .view-toggle {
    display: flex;
    background: #111a2b;
    border-radius: 0.5rem;
    padding: 0.25rem;
  }

  .view-toggle button {
    padding: 0.5rem 1rem;
    border: none;
    background: transparent;
    color: #94a3b8;
    border-radius: 0.375rem;
    cursor: pointer;
    font-size: 0.875rem;
    transition: all 0.15s ease;
  }

  .view-toggle button.active {
    background: rgba(245, 166, 35, 0.12);
    color: #f5a623;
  }

  .view-toggle button:hover:not(.active) {
    color: #e9edf6;
  }

  .create-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: #f5a623;
    border: none;
    border-radius: 0.5rem;
    color: #020617;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .create-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(245, 166, 35, 0.3);
  }

  .pipeline-view {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1rem;
    padding: 1.5rem;
    flex: 1;
    overflow-x: auto;
  }

  .pipeline-column {
    background: #0b1220;
    border-radius: 12px;
    border: 1px solid #1e293b;
    display: flex;
    flex-direction: column;
    min-width: 280px;
  }

  .column-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 1rem;
    border-bottom: 1px solid #1e293b;
  }

  .column-icon {
    font-size: 1rem;
  }

  .column-title {
    font-weight: 600;
    flex: 1;
    color: #e9edf6;
  }

  .column-count {
    background: #111a2b;
    padding: 0.125rem 0.5rem;
    border-radius: 1rem;
    font-size: 0.75rem;
    color: #94a3b8;
  }

  .column-content {
    flex: 1;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    overflow-y: auto;
  }

  .empty-column {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100px;
    color: #64748b;
    font-size: 0.875rem;
    border: 2px dashed #1e293b;
    border-radius: 0.5rem;
  }

  .strategy-card {
    background: #111a2b;
    border: 1px solid #1e293b;
    border-radius: 12px;
    padding: 1rem;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .strategy-card:hover {
    border-color: rgba(245, 166, 35, 0.38);
    transform: translateY(-2px);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  }

  .strategy-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }

  .strategy-icon {
    font-size: 1.25rem;
  }

  .strategy-title {
    flex: 1;
  }

  .strategy-title h4 {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
    color: #e9edf6;
  }

  .strategy-version {
    color: #64748b;
    font-size: 0.75rem;
  }

  .strategy-status {
    display: inline-block;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    font-size: 0.7rem;
    font-weight: 500;
    margin-bottom: 0.5rem;
  }

  .strategy-type {
    color: #94a3b8;
    font-size: 0.8rem;
    margin-bottom: 0.75rem;
  }

  .strategy-metrics {
    display: flex;
    gap: 1rem;
    margin-bottom: 0.75rem;
  }

  .metric {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .metric-label {
    color: #64748b;
    font-size: 0.7rem;
    text-transform: uppercase;
  }

  .metric-value {
    font-weight: 600;
    font-size: 0.9rem;
    font-variant-numeric: tabular-nums;
    color: #e9edf6;
  }

  .metric-value.positive {
    color: #35d29a;
  }

  .metric-value.negative {
    color: #f87171;
  }

  .paper-trading-progress {
    margin-bottom: 0.75rem;
  }

  .progress-label {
    font-size: 0.75rem;
    color: #94a3b8;
    display: block;
    margin-bottom: 0.25rem;
  }

  .progress-bar {
    height: 4px;
    background: #020617;
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: #f5a623;
    border-radius: 2px;
    transition: width 0.3s ease;
  }

  .strategy-footer {
    border-top: 1px solid #1e293b;
    padding-top: 0.5rem;
    margin-top: 0.5rem;
  }

  .last-updated {
    color: #64748b;
    font-size: 0.7rem;
  }

  .list-view {
    flex: 1;
    padding: 1.5rem;
    overflow-y: auto;
  }

  .list-filters {
    margin-bottom: 1rem;
  }

  .list-filters select {
    padding: 0.5rem 1rem;
    background: #111a2b;
    border: 1px solid #1e293b;
    border-radius: 0.5rem;
    color: #e9edf6;
    font-size: 0.875rem;
  }

  .strategy-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1rem;
  }

  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 200px;
    color: #64748b;
  }

  .loading-spinner {
    width: 32px;
    height: 32px;
    border: 3px solid rgba(245, 166, 35, 0.2);
    border-top-color: #f5a623;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 1rem;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
`;

export default StrategyListPanel;
